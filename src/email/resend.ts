import { Resend } from 'resend'
import { env } from '../shared/config/env.js'
import { getResendApiKey } from '../shared/secrets.js'

export interface EmailService {
  sendVerificationEmail(to: string, link: string, firstName: string): Promise<void>
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
    sendVerificationEmail: (to, link, firstName) =>
      send(to, 'Confirme seu e-mail no Fluxy', verificationHtml(link, firstName)),
    sendPasswordResetEmail: (to, link) =>
      send(to, 'Redefinição de senha no Fluxy', passwordResetHtml(link)),
  }
}

// Used in local dev (and any stage without a Resend key): logs the link instead
// of sending. Tests inject their own capturing implementation.
function consoleService(): EmailService {
  return {
    async sendVerificationEmail(to, link, firstName): Promise<void> {
      console.info(`[email] verification link for ${firstName} <${to}>: ${link}`)
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

function verificationHtml(link: string, firstName: string): string {
  return `<p>Olá, ${firstName}!</p><p>Confirme seu e-mail no Fluxy clicando no link abaixo:</p><p><a href="${link}">${link}</a></p>`
}

function passwordResetHtml(link: string): string {
  return `<p>Para redefinir sua senha no Fluxy, clique no link abaixo:</p><p><a href="${link}">${link}</a></p>`
}
