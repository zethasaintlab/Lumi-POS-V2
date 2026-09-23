export interface SkeletonLoaderProps {
  /** Which final layout to mirror. Never a generic circular spinner. */
  shape?: "card" | "row" | "qr" | "text";
  count?: number;
}
export function SkeletonLoader(props: SkeletonLoaderProps): JSX.Element;
