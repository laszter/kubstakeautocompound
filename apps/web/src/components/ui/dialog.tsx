"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

// Solid themed mask (--overlay: 45 % black light / 60 % dark), no blur.
function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-overlay duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

// < md: bottom sheet (full width, top corners rounded, slides up, scrolls inside); ≥ md: centred max-w-sm card.
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed z-50 grid gap-4 border border-border bg-popover p-5 text-sm text-popover-foreground shadow-xl outline-none duration-200 dark:shadow-[0_8px_32px_rgba(0,0,0,.5)] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          "max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:max-h-[85dvh] max-md:w-full max-md:max-w-none max-md:overflow-y-auto max-md:rounded-t-2xl max-md:rounded-b-none max-md:border-b-0 max-md:data-open:slide-in-from-bottom-10 max-md:data-closed:slide-out-to-bottom-10",
          "md:top-1/2 md:left-1/2 md:max-h-[calc(100dvh-2rem)] md:w-full md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:overflow-y-auto md:rounded-xl md:data-open:zoom-in-95 md:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3.5 right-3.5 text-muted-foreground hover:text-foreground"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

// Title row + hairline (reference). pr-12 keeps long titles clear of the close button.
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "-mx-5 flex flex-col gap-1.5 border-b border-border px-5 pr-12 pb-4",
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // header-only dialogs (no body): butt the footer against the header hairline instead of a double line + gap
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 border-t border-border bg-muted/40 p-5 sm:flex-row sm:justify-end md:rounded-b-xl [[data-slot=dialog-header]+&]:-mt-4 [[data-slot=dialog-header]+&]:border-t-0",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-snug font-semibold",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
