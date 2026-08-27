// components/wallets/wallet_icon.tsx — the glyph beside a wallet row.
//
// REPLACES `wallet_type_icon.tsx`, WHICH HAD ONE GLYPH PER WALLET TYPE. That
// component answered a question the app no longer asks: with the type picker
// gone there is no stored bank / e-wallet / savings distinction to draw, and
// the two facts that remain — is this owed, and can anything track it — are
// worth exactly two glyphs.
//
// AND THE BEST ICON IS USUALLY NOT AN ICON AT ALL. A wallet with a matcher has
// a PROVIDER, and `ProviderBadge` draws that provider's own colour and initial
// (constants/providers.ts). "BPI in red" identifies a row at a glance in a way
// a generic bank building never did — so the badge wins whenever the caller can
// resolve one, and this component is the fallback for when it cannot.
import { Banknote, CreditCard, Wallet as WalletGlyph } from "lucide-react-native";
import { View } from "react-native";

import { registerIcon, type IconComponent } from "@/components/ui/button";
import { walletKind, type WalletKind } from "@/lib/wallets/summary";
import type { Wallet } from "@/types/domain";

/**
 * One glyph per state. The states themselves — and the reason owed outranks
 * manual — live in `walletKind` (lib/wallets/summary.ts), so the CSV export and
 * this component cannot disagree about what a wallet is.
 */
export const WALLET_ICONS: Record<WalletKind, IconComponent> = {
  owed: CreditCard,
  manual: Banknote,
  tracked: WalletGlyph,
};

export type WalletIconProps = {
  wallet: Wallet;
  size?: number;
  /** Contract §2 token classes only — the caller decides the tone. */
  className?: string;
  testID?: string;
};

export function WalletIcon({
  wallet,
  size = 20,
  className = "text-fg-2 dark:text-fg-2-dark",
  testID,
}: WalletIconProps) {
  // Lucide icons ignore `className` until cssInterop has been run over them,
  // and they arrive here as values out of a map rather than as a module-scope
  // import — the case registerIcon's WeakSet exists for.
  const Icon = registerIcon(WALLET_ICONS[walletKind(wallet)]);

  // The wrapper carries the testID rather than the Svg: react-native-svg's
  // prop forwarding is not something this component should depend on, and the
  // View adds no layout of its own.
  return (
    <View testID={testID}>
      <Icon size={size} className={className} />
    </View>
  );
}
