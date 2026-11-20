const nodemailer = require('nodemailer');
const { db } = require('../config/firestore');
const ApiError = require('../utils/api-error');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'codejs.business@gmail.com',
    pass: process.env.EMAIL_PASS || '',
  },
});

async function sendSupportTicket({ uid, email, username, subject, message, deviceInfo }) {
  if (!message || message.trim().length < 5) {
    throw new ApiError(400, 'INVALID_MESSAGE', 'El mensaje debe tener al menos 5 caracteres.');
  }

  const cleanSubject = subject?.trim() || 'Consulta de Soporte - BLOKIO Puzzle';
  const cleanEmail = email?.trim() || 'No especificado';
  const cleanUsername = username?.trim() || 'Jugador';
  const now = new Date();

  // 1. Guardar ticket en Firestore
  try {
    await db.collection('support_tickets').add({
      uid: uid || null,
      email: cleanEmail,
      username: cleanUsername,
      subject: cleanSubject,
      message,
      deviceInfo: deviceInfo || null,
      status: 'pending',
      createdAt: now,
    });
  } catch (err) {
    console.error('Error guardando ticket en Firestore:', err);
  }

  // 2. Enviar correo vía Nodemailer
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const mailOptions = {
      from: `"BLOKIO Soporte" <${process.env.EMAIL_USER}>`,
      to: 'codejs.business@gmail.com',
      replyTo: cleanEmail !== 'No especificado' ? cleanEmail : process.env.EMAIL_USER,
      subject: `[BLOKIO Soporte] ${cleanSubject} - ${cleanUsername}`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #0b1020; color: #ffffff; padding: 24px; border-radius: 12px;">
          <h2 style="color: #00f5d4; margin-top: 0;">Nuevo Ticket de Soporte - BLOKIO Puzzle</h2>
          <hr style="border: 1px solid rgba(255,255,255,0.1);" />
          <p><strong>Usuario:</strong> ${cleanUsername}</p>
          <p><strong>ID Usuario (UID):</strong> ${uid || 'Anónimo / No logueado'}</p>
          <p><strong>Correo del Usuario:</strong> ${cleanEmail}</p>
          <p><strong>Asunto:</strong> ${cleanSubject}</p>
          <p><strong>Fecha:</strong> ${now.toISOString()}</p>
          ${deviceInfo ? `<p><strong>Dispositivo / Versión:</strong> ${JSON.stringify(deviceInfo)}</p>` : ''}
          <div style="background-color: #141b2d; padding: 16px; border-radius: 8px; border-left: 4px solid #00f5d4; margin-top: 16px;">
            <h3 style="color: #8a71ff; margin-top: 0;">Mensaje:</h3>
            <p style="white-space: pre-wrap; color: #e2e8f0;">${message}</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
  }

  return { success: true, message: 'Ticket de soporte enviado correctamente.' };
}

module.exports = { sendSupportTicket };
