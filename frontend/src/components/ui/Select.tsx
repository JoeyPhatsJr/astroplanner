import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { usePopupContainer } from "./popupContainer";

export type SelectOption = { value: string; label: string };

/**
 * Themed select. The native popup is drawn by the OS in its own colours, so night vision could not make it red;
 * this one is built from the theme's CSS variables. Name it with a <label htmlFor={id}> or `ariaLabel`.
 */
export function Select({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  className = "",
}: {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [container, triggerRef] = usePopupContainer();
  return (
    <BaseSelect.Root
      items={options}
      value={options.some((o) => o.value === value) ? value : null}
      onValueChange={(v) => v !== null && onChange(v)}
      disabled={disabled}
    >
      <BaseSelect.Trigger id={id} ref={triggerRef} aria-label={ariaLabel} className={`field select-trigger ${className}`}>
        <BaseSelect.Value className="min-w-0 flex-1 truncate text-left" placeholder={placeholder} />
        <BaseSelect.Icon className="shrink-0 text-muted">
          <ChevronDown className="size-4" aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={container ?? undefined}>
        <BaseSelect.Positioner className="pop-positioner" sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className="pop select-popup">
            <BaseSelect.List className="select-list">
              {options.map((o) => (
                <BaseSelect.Item key={o.value} value={o.value} className="select-item">
                  <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{o.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="shrink-0 text-ice">
                    <Check className="size-4" aria-hidden />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
