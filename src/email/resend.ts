import { Resend } from 'resend'
import { env } from '../shared/config/env.js'
import { getResendApiKey } from '../shared/secrets.js'

export interface EmailService {
  sendVerificationEmail(to: string, code: string): Promise<void>
  sendPasswordResetEmail(to: string, link: string): Promise<void>
}

declare module 'fastify' {
  interface FastifyInstance {
    email: EmailService
  }
}

function resendService(apiKey: string): EmailService {
  const resend = new Resend(apiKey)

  async function send(to: string, subject: string, html: string): Promise<void> {
    const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html })
    if (error) {
      throw new Error(`Failed to send e-mail: ${error.message}`)
    }
  }

  return {
    sendVerificationEmail: (to, code) => send(to, 'Confirme seu e-mail no Fluxy', verificationHtml(code)),
    sendPasswordResetEmail: (to, link) =>
      send(to, 'Redefinição de senha no Fluxy', passwordResetHtml(link)),
  }
}

// Used in local dev (and any stage without a Resend key): logs the link instead
// of sending. Tests inject their own capturing implementation.
function consoleService(): EmailService {
  return {
    async sendVerificationEmail(to, code): Promise<void> {
      console.info(`[email] verification code for <${to}>: ${code}`)
    },
    async sendPasswordResetEmail(to, link): Promise<void> {
      console.info(`[email] password reset link for ${to}: ${link}`)
    },
  }
}

export async function createEmailService(): Promise<EmailService> {
  const apiKey = await getResendApiKey()
  return apiKey ? resendService(apiKey) : consoleService()
}

function verificationHtml(code: string): string {
  return `
    <p>Olá!</p>
    <p>Seu código de verificação do Fluxy é:</p>
    <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>
    <p>O código expira em ${env.VERIFY_OTP_TTL_MINUTES} minutos.</p>
    <p>Se você não pediu este código, ignore este e-mail.</p>
  `
}

function passwordResetHtml(link: string): string {
  return `<p>Para redefinir sua senha no Fluxy, clique no link abaixo:</p><p><a href="${link}">${link}</a></p>`
}
