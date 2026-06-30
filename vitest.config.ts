import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Disable the verification-OTP resend cooldown so tests can request a fresh
    // code immediately; the cooldown is exercised manually / in real stages.
    env: {
      VERIFY_OTP_RESEND_COOLDOWN_SECONDS: '0',
    },
  },
})
