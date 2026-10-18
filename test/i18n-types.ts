import { t } from "../lib/i18n"

// Compile-only contract: keys and all interpolation names are checked by typecheck.
function translationTypes() {
  t("video.pressPlay")
  t("roomPanel.timing", { rtt: 12, uncertainty: 3 })
  t("playerIndicator.blockedCount", { count: 2 })
  // @ts-expect-error Unknown message keys must fail.
  t("missing.translation")
  // @ts-expect-error Templates require their interpolation variables.
  t("roomPanel.timing")
  // @ts-expect-error A partially supplied template must fail.
  t("roomPanel.timing", { rtt: 12 })
}
void translationTypes
