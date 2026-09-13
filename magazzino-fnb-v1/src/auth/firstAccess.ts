export function buildFirstAccessOptions(email: string, origin: string) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error('Inserisci un indirizzo email')
  }

  return {
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: origin.replace(/\/$/, ''),
    },
  }
}
