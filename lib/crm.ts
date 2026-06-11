export type CrmDepartmentKey =
  | "general"
  | "support"
  | "billing"
  | "operations"
  | "rider_management"
  | "trust_safety"
  | "technical"
  | "engineering"
  | "product"
  | "finance"

export type CrmDepartment = {
  key: CrmDepartmentKey
  label: string
  emailAlias: string
  keywords: string[]
  aliases: string[]
}

export const CRM_DEPARTMENTS: CrmDepartment[] = [
  {
    key: "general",
    label: "General",
    emailAlias: "support@charterkeke.com",
    keywords: ["general", "hello", "other"],
    aliases: ["support", "general"],
  },
  {
    key: "support",
    label: "Customer Support",
    emailAlias: "support@charterkeke.com",
    keywords: ["support", "help", "complaint", "account", "login"],
    aliases: ["support", "help", "customer-support"],
  },
  {
    key: "billing",
    label: "Billing",
    emailAlias: "billing@charterkeke.com",
    keywords: ["billing", "payment", "fare", "refund", "charge"],
    aliases: ["billing", "finance"],
  },
  {
    key: "operations",
    label: "Operations",
    emailAlias: "operations@charterkeke.com",
    keywords: ["operations", "dispatch", "ride", "driver", "rider"],
    aliases: ["operations", "ops"],
  },
  {
    key: "rider_management",
    label: "Rider Management",
    emailAlias: "riders@charterkeke.com",
    keywords: ["rider", "driver", "assignment", "fleet"],
    aliases: ["rider-management", "riders"],
  },
  {
    key: "trust_safety",
    label: "Trust and Safety",
    emailAlias: "safety@charterkeke.com",
    keywords: ["safety", "fraud", "abuse", "harass", "incident"],
    aliases: ["safety", "trust-safety"],
  },
  {
    key: "technical",
    label: "Technical Support",
    emailAlias: "tech@charterkeke.com",
    keywords: ["bug", "error", "crash", "api", "technical", "app issue", "website issue"],
    aliases: ["tech", "technical", "technical-support"],
  },
  {
    key: "engineering",
    label: "Engineering",
    emailAlias: "engineering@charterkeke.com",
    keywords: ["engineering", "integration", "release", "deployment", "feature", "tour", "ui", "ux", "app"],
    aliases: ["engineering", "engineer", "dev", "developer", "developers"],
  },
  {
    key: "product",
    label: "Product and Systems",
    emailAlias: "product@charterkeke.com",
    keywords: ["product", "feature", "workflow", "system"],
    aliases: ["product", "systems"],
  },
  {
    key: "finance",
    label: "Finance",
    emailAlias: "finance@charterkeke.com",
    keywords: ["finance", "settlement", "remittance", "reconciliation", "payout"],
    aliases: ["finance", "accounts"],
  },
]

export const CRM_EMAIL_HEADER_KEYS = [
  "delivered-to",
  "x-original-to",
  "x-forwarded-to",
  "envelope-to",
  "recipient",
  "to",
]

export function normalizeEmailAddress(value?: string | null): string {
  return (value || "").trim().toLowerCase().replace(/^<|>$/g, "")
}

export function extractEmailAddresses(raw?: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/[;,]/)
    .map((item) => {
      const match = item.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
      return normalizeEmailAddress(match?.[0] || item)
    })
    .filter(Boolean)
}

export function extractRecipientFromHeaders(headers?: Record<string, string | null | undefined>): string | null {
  if (!headers) return null

  const normalizedHeaders = Object.entries(headers).reduce<Record<string, string | null | undefined>>((acc, [key, value]) => {
    acc[key.toLowerCase()] = value
    return acc
  }, {})

  for (const headerKey of CRM_EMAIL_HEADER_KEYS) {
    const rawValue = normalizedHeaders[headerKey]
    const addresses = extractEmailAddresses(rawValue)
    if (addresses.length) {
      return addresses[0]
    }
  }

  return null
}

export function getDepartmentByKey(key?: string | null): CrmDepartment {
  const normalizedKey = normalizeEmailAddress(key).replace(/@.+$/, "") as CrmDepartmentKey
  return CRM_DEPARTMENTS.find((department) => department.key === normalizedKey) || CRM_DEPARTMENTS[0]
}

export function resolveDepartmentKeyFromText(input: {
  subject?: string | null
  body?: string | null
  senderEmail?: string | null
  recipientEmail?: string | null
}): CrmDepartmentKey {
  const text = normalizeEmailAddress(
    `${input.subject || ""} ${input.body || ""} ${input.senderEmail || ""} ${input.recipientEmail || ""}`
  )

  const recipient = normalizeEmailAddress(input.recipientEmail)
  const recipientLocalPart = recipient.split("@")[0] || ""

  for (const department of CRM_DEPARTMENTS) {
    if (department.aliases.some((alias) => recipientLocalPart.includes(alias) || recipient.includes(alias))) {
      return department.key
    }
  }

  for (const department of CRM_DEPARTMENTS) {
    if (department.key !== "general" && department.key !== "support") {
      if (department.key === recipientLocalPart) return department.key
      if (department.key.includes(recipientLocalPart)) return department.key
    }
  }

  for (const department of CRM_DEPARTMENTS) {
    if (department.key === "general") continue
    if (department.key === "support" && (text.includes("support") || text.includes("help"))) {
      return department.key
    }
    if (department.key === "billing" && department.key && department.key.length && department.key) {
      if (department.key === "billing" && (text.includes("payment") || text.includes("fare") || text.includes("refund"))) {
        return department.key
      }
    }
    if (department.key === "operations" && (text.includes("dispatch") || text.includes("ride") || text.includes("driver"))) {
      return department.key
    }
    if (department.key === "trust_safety" && (text.includes("fraud") || text.includes("abuse") || text.includes("safety"))) {
      return department.key
    }
    if (department.key === "technical" && (text.includes("bug") || text.includes("crash") || text.includes("error") || text.includes("api"))) {
      return department.key
    }
    if (
      department.key === "engineering" &&
      (text.includes("integration") ||
        text.includes("deployment") ||
        text.includes("release") ||
        text.includes("feature") ||
        text.includes("tour") ||
        text.includes("ui") ||
        text.includes("ux") ||
        text.includes("app"))
    ) {
      return department.key
    }
    if (department.key === "finance" && (text.includes("settlement") || text.includes("remittance") || text.includes("reconciliation"))) {
      return department.key
    }
  }

  return "general"
}

export function departmentEmailAliases(): string[] {
  const envAliases = [
    process.env.CRM_EMAIL_ALIASES,
    process.env.CRM_DEPARTMENT_EMAIL_ALIASES,
    process.env.CRM_SUPPORT_EMAIL_ALIASES,
    process.env.CRM_PRIMARY_SUPPORT_INBOX,
  ]
    .join(",")
    .split(/[,\s;]+/)
    .map((value) => normalizeEmailAddress(value))
    .filter(Boolean)

  return Array.from(new Set([...CRM_DEPARTMENTS.map((department) => department.emailAlias), ...envAliases]))
}
