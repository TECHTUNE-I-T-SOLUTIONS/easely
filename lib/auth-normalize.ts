export function normalizeEmail(value?: string | null) {
  return String(value || "").trim().toLowerCase()
}

export function normalizePhone(value?: string | null) {
  const raw = String(value || "").trim()
  const digits = raw.replace(/\D/g, "")
  if (!digits) return ""
  if (digits.startsWith("234")) return `+${digits}`
  if (digits.startsWith("0")) return `+234${digits.slice(1)}`
  if (digits.length === 10) return `+234${digits}`
  return raw.startsWith("+") ? `+${digits}` : digits
}

export function phoneVariants(value?: string | null) {
  const normalized = normalizePhone(value)
  const digits = normalized.replace(/\D/g, "")
  const variants = new Set<string>()
  const add = (candidate?: string | null) => {
    const text = String(candidate || "").trim()
    if (text) variants.add(text)
  }

  add(value)
  add(normalized)
  add(digits)

  if (digits.startsWith("234") && digits.length >= 13) {
    add(`+${digits}`)
    add(`0${digits.slice(3)}`)
    add(`${digits.slice(0, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`)
    add(`+${digits.slice(0, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`)
  }

  if (digits.startsWith("0") && digits.length >= 11) {
    const national = digits
    const intl = `234${digits.slice(1)}`
    add(national)
    add(`+${intl}`)
    add(intl)
    add(`${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`)
    add(`+${intl.slice(0, 6)} ${intl.slice(6, 9)} ${intl.slice(9)}`)
  }

  return Array.from(variants).filter(Boolean)
}
