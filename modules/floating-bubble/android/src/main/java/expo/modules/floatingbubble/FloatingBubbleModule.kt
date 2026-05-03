package expo.modules.floatingbubble

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FloatingBubbleModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("FloatingBubble")

    Function("hasPermission") {
      OverlayPermissionHelper.hasPermission(context())
    }

    AsyncFunction("requestPermission") {
      OverlayPermissionHelper.openSettings(context())
    }

    AsyncFunction("start") { options: Map<String, Any?>? ->
      if (!OverlayPermissionHelper.hasPermission(context())) {
        throw OverlayPermissionMissing()
      }
      val sizeDp = (options?.get("sizeDp") as? Number)?.toInt()
        ?: FloatingBubbleManager.DEFAULT_SIZE_DP
      FloatingBubbleService.start(context(), sizeDp)
    }

    AsyncFunction("stop") {
      FloatingBubbleService.stop(context())
    }

    Function("isRunning") {
      FloatingBubbleService.isRunning
    }
  }

  private fun context() =
    appContext.reactContext?.applicationContext
      ?: throw Exceptions.ReactContextLost()
}

class OverlayPermissionMissing :
  expo.modules.kotlin.exception.CodedException(
    "ERR_OVERLAY_PERMISSION",
    "SYSTEM_ALERT_WINDOW permission has not been granted",
    null
  )
