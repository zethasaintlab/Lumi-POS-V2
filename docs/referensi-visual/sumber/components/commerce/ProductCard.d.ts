export interface ProductCardProps {
  name: string;
  /** Pre-formatted price string, e.g. "Rp 18.000". */
  price: string;
  /**
   * undefined = not photographed yet -> renders name/price only, deliberately with no placeholder box.
   * a url string = photographed -> renders the photo.
   * the literal string "failed" = image failed to load -> renders the named dashed-frame state.
   * Never conflate the last two: they call for different owner action.
   */
  image?: string | "failed";
  onClick?: () => void;
}

/**
 * @startingPoint section="Commerce" subtitle="Photographed, not-yet-photographed, and failed-to-load states" viewport="700x220"
 */
export function ProductCard(props: ProductCardProps): JSX.Element;
