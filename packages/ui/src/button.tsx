"use client";

import * as React from "react";
import { cx } from "./cx.ts";
import { Tip, Tooltip } from "./overlay.tsx";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** One line on what it does, shown when the pointer rests on it. Its words say what it is. */
  tip?: string;
  /** It started something that is still going: it cannot be pressed again, and spins where its icon was. */
  busy?: boolean;
}

/** One `primary` per view: that is a design rule, and the reason ember is not a general background. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", block, className, type = "button", tip, busy, disabled, ...rest },
  ref,
) {
  return (
    <Tip text={tip}>
      <button
        ref={ref}
        type={type}
        className={cx("btn", `btn-${variant}`, size !== "md" && `btn-${size}`, block && "btn-block", className)}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...rest}
      />
    </Tip>
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon alone is not a name. Also used as the tooltip. */
  label: string;
  /** One line on what it does, under the name in its tooltip. */
  hint?: string;
  large?: boolean;
  pressed?: boolean;
  shortcut?: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, hint, large, pressed, shortcut, className, type = "button", ...rest },
  ref,
) {
  return (
    <Tooltip label={label} hint={hint} shortcut={shortcut}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        className={cx("icon-btn", large && "icon-btn-lg", className)}
        {...rest}
      />
    </Tooltip>
  );
});
