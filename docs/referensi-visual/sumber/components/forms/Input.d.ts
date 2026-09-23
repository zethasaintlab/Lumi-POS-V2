export interface InputProps {
  /** Always rendered above the field. Never replaced by a placeholder. */
  label: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Optional helper text below the field, replaced by `error` when present. */
  hint?: string;
  /** Error text below the field. Also switches the border and helper text to the destructive color. */
  error?: string;
  type?: string;
  placeholder?: string;
}
export function Input(props: InputProps): JSX.Element;
