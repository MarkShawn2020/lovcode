import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons"

import { selectOptionMatches, shouldEnableSelectFilter } from "@/lib/selectFilter"
import { cn } from "@/lib/utils"

type SelectContentProps = React.ComponentProps<typeof SelectPrimitive.Content> & {
  filterThreshold?: number
  searchPlaceholder?: string
  emptyText?: string
}

type SelectItemProps = React.ComponentProps<typeof SelectPrimitive.Item> & {
  sticky?: boolean
}

type SelectChildProps = {
  children?: React.ReactNode
  textValue?: string
  "aria-label"?: string
}

type SelectFilterContextValue = {
  enabled: boolean
  query: string
  registerItem: (matchesQuery: boolean) => () => void
}

type RegisteredItemCounts = {
  matching: number
  total: number
}

const SelectFilterContext = React.createContext<SelectFilterContextValue | null>(null)

function childText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (!React.isValidElement<SelectChildProps>(node)) {
    return React.Children.toArray(node).map(childText).join(" ")
  }
  return childText(node.props.children)
}

function selectItemSearchText(props: SelectChildProps) {
  return [props.textValue, props["aria-label"], childText(props.children)]
    .filter(Boolean)
    .join(" ")
}

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  filterThreshold,
  searchPlaceholder = "筛选选项…",
  emptyText = "没有匹配的选项",
  onCloseAutoFocus,
  ...props
}: SelectContentProps) {
  const [query, setQuery] = React.useState("")
  const [registeredItems, setRegisteredItems] = React.useState<RegisteredItemCounts>({
    matching: 0,
    total: 0,
  })
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const focusFrameRef = React.useRef<number | null>(null)
  const filterEnabled = shouldEnableSelectFilter(registeredItems.total, filterThreshold)

  const registerItem = React.useCallback((matchesQuery: boolean) => {
    setRegisteredItems((current) => ({
      matching: current.matching + (matchesQuery ? 1 : 0),
      total: current.total + 1,
    }))
    return () => {
      setRegisteredItems((current) => ({
        matching: Math.max(0, current.matching - (matchesQuery ? 1 : 0)),
        total: Math.max(0, current.total - 1),
      }))
    }
  }, [])

  const filterContext = React.useMemo<SelectFilterContextValue>(() => ({
    enabled: filterEnabled,
    query,
    registerItem,
  }), [filterEnabled, query, registerItem])

  const focusFilterInput = React.useCallback((node: HTMLInputElement | null) => {
    if (typeof window === "undefined") return
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
    if (!node) return
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = window.requestAnimationFrame(() => {
        focusFrameRef.current = null
        if (node.isConnected) node.focus()
      })
    })
  }, [])

  React.useEffect(() => () => {
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
  }, [])

  const focusOption = (edge: "first" | "last") => {
    const options = viewportRef.current?.querySelectorAll<HTMLElement>(
      '[role="option"]:not([data-disabled]):not([hidden])',
    )
    const option = edge === "first" ? options?.[0] : options?.[options.length - 1]
    option?.focus()
  }

  return (
    <SelectFilterContext.Provider value={filterContext}>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          data-slot="select-content"
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className
          )}
          position={position}
          align={align}
          onCloseAutoFocus={(event) => {
            setQuery("")
            onCloseAutoFocus?.(event)
          }}
          {...(filterEnabled ? { role: "dialog", "aria-label": "筛选并选择选项" } : {})}
          {...props}
        >
          {filterEnabled && (
            <div className="relative shrink-0 border-b border-border p-2" data-slot="select-filter">
              <MagnifyingGlassIcon className="text-muted-foreground pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2" />
              <input
                ref={focusFilterInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    event.stopPropagation()
                    focusOption("first")
                    return
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    event.stopPropagation()
                    focusOption("last")
                    return
                  }
                  if (event.key === "Escape" && query) {
                    event.preventDefault()
                    event.stopPropagation()
                    setQuery("")
                    return
                  }
                  if (event.key !== "Escape") event.stopPropagation()
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground outline-none transition focus:ring-2"
              />
            </div>
          )}
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            ref={viewportRef}
            {...(filterEnabled ? { role: "listbox", "aria-label": "可选项" } : {})}
            className={cn(
              "p-1",
              position === "popper" &&
                "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
            )}
          >
            {children}
            {filterEnabled && query && registeredItems.matching === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground" role="status">
                {emptyText}
              </div>
            )}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectFilterContext.Provider>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  hidden,
  sticky = false,
  textValue,
  "aria-label": ariaLabel,
  "aria-hidden": ariaHidden,
  ...props
}: SelectItemProps) {
  const filterContext = React.useContext(SelectFilterContext)
  const searchText = selectItemSearchText({
    children,
    textValue,
    "aria-label": ariaLabel,
  })
  const matchesQuery = selectOptionMatches(searchText, filterContext?.query ?? "")
  const filteredOut = Boolean(
    filterContext?.enabled && filterContext.query && !sticky && !matchesQuery,
  )

  React.useLayoutEffect(() => {
    if (!filterContext) return
    return filterContext.registerItem(matchesQuery)
  }, [filterContext?.registerItem, matchesQuery])

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-filtered-out={filteredOut ? "" : undefined}
      data-sticky={sticky ? "" : undefined}
      hidden={hidden || filteredOut}
      textValue={textValue}
      aria-label={ariaLabel}
      aria-hidden={filteredOut || ariaHidden}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        sticky && "sticky top-0 z-10 border-b border-border bg-popover shadow-sm",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
