// components/wallets/wallet_type_icon.tsx — m1c plan Task 4, rule 2.
//
// One glyph per wallet type, FIVE DIFFERENT GLYPHS. The icon is how a user
// tells a bank row from an e-wallet row at a glance while scrolling; two types
// sharing a glyph makes the list quietly unreadable rather than visibly broken,
// so the suite pins both the mapping and its distinctness.
import { Banknote, CreditCard, Landmark, PiggyBank, Smartphone } from "lucide-react-native";
import { View } from "react-native";

import { registerIcon, type IconComponent } from "@/components/ui/button";
import type { WalletType } from "@/types/domain";

/** Plan rule 2, verbatim. Exported so the mapping itself can be asserted. */
export const WALLET_TYPE_ICONS: Record<WalletType, IconComponent> = {
  bank: Landmark,
  "e-wallet": Smartphone,
  savings: PiggyBank,
  credit: CreditCard,
  cash: Banknote,
};

export type WalletTypeIconProps = {
  type: WalletType;
  size?: number;
  /** Contract §2 token classes only — the caller decides the tone. */
  className?: string;
  testID?: string;
};

export function WalletTypeIcon({
  type,
  size = 20,
  className = "text-fg-2 dark:text-fg-2-dark",
  testID,
}: WalletTypeIconProps) {
  // Lucide icons ignore `className` until cssInterop has been run over them,
  // and they arrive here as values out of a map rather than as a module-scope
  // import — the case registerIcon's WeakSet exists for.
  const Icon = registerIcon(WALLET_TYPE_ICONS[type]);

  // The wrapper carries the testID rather than the Svg: react-native-svg's
  // prop forwarding is not something this component should depend on, and the
  // View adds no layout of its own.
  return (
    <View testID={testID}>
      <Icon size={size} className={className} />
    </View>
  );
}
