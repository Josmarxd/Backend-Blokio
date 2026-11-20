const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const { db } = require('../config/firestore');
const ApiError = require('../utils/api-error');

const PACKAGE_NAME =
  process.env.ANDROID_PACKAGE_NAME || 'com.codejs.blokio_puzzle';

// Debe coincidir con BillingConfig en lib/core/services/purchase_service.dart.
const CONSUMABLES = new Set(['gems_100', 'gems_300', 'gems_800']);
const NON_CONSUMABLES = new Set([
  'remove_ads',
  'bg_premium_1',
  'bg_premium_2',
  'bg_premium_3',
  'bg_premium_4',
  'bg_premium_5',
]);

const purchases = db.collection('billing_purchases');

let googleAuthClient = null;

async function getAndroidPublisherClient() {
  if (googleAuthClient) return googleAuthClient;
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  googleAuthClient = await auth.getClient();
  return googleAuthClient;
}

function tokenDocId(packageName, purchaseToken) {
  return crypto
    .createHash('sha256')
    .update(`${packageName}:${purchaseToken}`)
    .digest('hex');
}

function productUrl(packageName, productId, purchaseToken, suffix = '') {
  return (
    'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    `${encodeURIComponent(packageName)}/purchases/products/` +
    `${encodeURIComponent(productId)}/tokens/` +
    `${encodeURIComponent(purchaseToken)}${suffix}`
  );
}

/**
 * Valida una compra de producto integrado en la app contra la Google Play
 * Developer API y registra su entrega para que no pueda canjearse dos veces.
 */
async function verifyGooglePlayPurchase({
  uid,
  productId,
  purchaseToken,
  packageName,
}) {
  const product = String(productId || '').trim();
  const token = String(purchaseToken || '').trim();
  const pkg = String(packageName || PACKAGE_NAME).trim();

  if (!uid) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión.');
  }
  if (!product || !token) {
    throw new ApiError(
      400,
      'INVALID_PURCHASE',
      'Faltan datos de la compra (productId y purchaseToken).',
    );
  }
  if (pkg !== PACKAGE_NAME) {
    throw new ApiError(
      400,
      'INVALID_PACKAGE',
      'El paquete de la compra no corresponde a BLOKIO.',
    );
  }
  const isConsumable = CONSUMABLES.has(product);
  if (!isConsumable && !NON_CONSUMABLES.has(product)) {
    throw new ApiError(
      400,
      'UNKNOWN_PRODUCT',
      'Ese producto no existe en el catálogo.',
    );
  }

  const docId = tokenDocId(pkg, token);
  const recordRef = purchases.doc(docId);
  const existing = await recordRef.get();

  if (existing.exists) {
    const record = existing.data();
    if (record.uid !== uid) {
      throw new ApiError(
        409,
        'PURCHASE_ALREADY_USED',
        'Esa compra ya está asociada a otra cuenta.',
      );
    }
    // Compra ya entregada: se responde válida pero sin volver a conceder.
    return {
      valid: true,
      alreadyProcessed: true,
      productId: product,
      consumable: isConsumable,
    };
  }

  const client = await getAndroidPublisherClient();

  let data;
  try {
    const response = await client.request({
      url: productUrl(pkg, product, token),
      method: 'GET',
    });
    data = response.data || {};
  } catch (error) {
    const status = error?.response?.status;
    if (status === 404 || status === 400) {
      throw new ApiError(
        400,
        'PURCHASE_NOT_FOUND',
        'Google Play no reconoce esta compra.',
      );
    }
    throw new ApiError(
      502,
      'PLAY_API_ERROR',
      'No se pudo verificar la compra con Google Play.',
    );
  }

  // purchaseState: 0 = comprada, 1 = cancelada, 2 = pendiente.
  if (data.purchaseState !== 0) {
    throw new ApiError(
      409,
      'PURCHASE_NOT_COMPLETED',
      'La compra no está completada en Google Play.',
    );
  }

  // Los consumibles se consumen en Google Play tras entregarlos.
  if (isConsumable && data.consumptionState !== 1) {
    try {
      await client.request({
        url: productUrl(pkg, product, token, ':consume'),
        method: 'POST',
      });
    } catch (error) {
      // Si ya estaba consumido, el reintento también falla: no bloquea la
      // entrega porque la compra fue verificada arriba.
      const status = error?.response?.status;
      if (status !== 400 && status !== 409) {
        throw new ApiError(
          502,
          'PLAY_API_ERROR',
          'No se pudo consumir la compra en Google Play.',
        );
      }
    }
  } else if (!isConsumable && data.acknowledgementState === 0) {
    // Los no consumibles deben confirmarse en los 3 días siguientes.
    try {
      await client.request({
        url: productUrl(pkg, product, token, ':acknowledge'),
        method: 'POST',
      });
    } catch (error) {
      // El cliente también llama a completePurchase(); no bloquea la entrega.
    }
  }

  await recordRef.set({
    uid,
    productId: product,
    packageName: pkg,
    orderId: data.orderId || null,
    purchaseTimeMillis: data.purchaseTimeMillis || null,
    consumable: isConsumable,
    verifiedAt: new Date(),
  });

  // Se guarda también en el perfil para poder auditar la cuenta.
  await db
    .collection('users')
    .doc(uid)
    .set(
      {
        purchases: {
          [product]: {
            lastOrderId: data.orderId || null,
            lastPurchasedAt: new Date(),
          },
        },
      },
      { merge: true },
    );

  return {
    valid: true,
    alreadyProcessed: false,
    productId: product,
    consumable: isConsumable,
  };
}

module.exports = {
  verifyGooglePlayPurchase,
  PACKAGE_NAME,
};
