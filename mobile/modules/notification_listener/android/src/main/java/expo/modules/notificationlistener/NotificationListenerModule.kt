package expo.modules.notificationlistener

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing surface of the notification listener. The JS name is pinned by the
 * interface contract §4 wrapper (mobile/modules/notification_listener/index.ts).
 */
class NotificationListenerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotificationListener")
  }
}
