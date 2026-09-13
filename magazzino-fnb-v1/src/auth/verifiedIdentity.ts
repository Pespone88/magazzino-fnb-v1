type ClaimsResult = {
  data: { claims: { sub?: unknown } | null } | null
  error: Error | null
}

type ClaimsAuthClient = {
  getClaims(): Promise<ClaimsResult>
}

export async function getVerifiedUserId(auth: ClaimsAuthClient): Promise<string | null> {
  const { data, error } = await auth.getClaims()
  if (error) throw error

  const subject = data?.claims?.sub
  return typeof subject === 'string' && subject.length > 0 ? subject : null
}
