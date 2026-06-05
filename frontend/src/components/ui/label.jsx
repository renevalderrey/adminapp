import * as React from "react"
import { Field } from "@base-ui/react/field"
import { cn } from "@/lib/utils"

function Label({ className, ...props }) {
  return (
    <Field.Label
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
