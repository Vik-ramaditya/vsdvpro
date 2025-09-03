// Minimal cva-like helper (class variance authority style)
export type CVADef = {
  variants?: Record<string, Record<string, string>>
  defaultVariants?: Record<string, string>
}

export function cva(base: string, config: CVADef) {
  return function compose(options: any = {}) {
    const classes = [base]
    const { variants = {}, defaultVariants = {} } = config
    Object.keys(variants).forEach(vKey => {
      const value = options[vKey] || defaultVariants[vKey]
      if (value && variants[vKey][value]) classes.push(variants[vKey][value])
    })
    if (options.className) classes.push(options.className)
    return classes.join(' ')
  }
}

export type VariantProps<T> = T extends (...args: any[]) => any ? Parameters<T>[0] : never
