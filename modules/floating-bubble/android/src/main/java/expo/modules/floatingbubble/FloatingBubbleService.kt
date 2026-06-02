package expo.modules.floatingbubble

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner

class FloatingBubbleService : Service() {

  private var manager: FloatingBubbleManager? = null
  private var sizeDp: Int = FloatingBubbleManager.DEFAULT_SIZE_DP
  private var appInForeground: Boolean = false

  private val lifecycleObserver = object : DefaultLifecycleObserver {
    override fun onStart(owner: LifecycleOwner) {
      appInForeground = true
      manager?.hide()
    }

    override fun onStop(owner: LifecycleOwner) {
      appInForeground = false
      if (isRunning) {
        manager?.show(sizeDp)
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val notification = NotificationHelper.build(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NotificationHelper.NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      )
    } else {
      startForeground(NotificationHelper.NOTIFICATION_ID, notification)
    }
    manager = FloatingBubbleManager(applicationContext)

    // Service.onCreate läuft auf dem Main Thread → ProcessLifecycleOwner darf hier
    // direkt synchron gelesen werden. Vorher wurde das in mainHandler.post {} verzögert,
    // wodurch onStartCommand mit appInForeground=false lief und die Bubble fälschlicherweise
    // sofort eingeblendet wurde, obwohl die App im Vordergrund war.
    val lifecycle = ProcessLifecycleOwner.get().lifecycle
    appInForeground = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    lifecycle.addObserver(lifecycleObserver)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Expliziter Stop (Offline/Abmelden) → Dienst sauber beenden, NICHT neu starten.
    if (intent?.action == ACTION_STOP) {
      isRunning = false
      stopBubble()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    // Ab hier: normaler Start ODER System-Neustart nach Kill (intent == null).
    // Bei einem Prozess-Kill wird die statische isRunning auf false zurückgesetzt,
    // daher setzen wir sie hier wieder true, damit der Dienst weiterläuft und die
    // Bubble erneut aufgebaut wird, statt sich selbst zu beenden.
    isRunning = true

    // sizeDp nur aus einem echten Intent übernehmen; beim System-Neustart (null)
    // bleibt der zuletzt gesetzte bzw. Default-Wert erhalten.
    intent?.getIntExtra(EXTRA_SIZE_DP, sizeDp)?.let { sizeDp = it }

    if (!appInForeground) {
      manager?.show(sizeDp)
    }

    // START_STICKY: Android baut den Dienst nach einem Kill (Speicherdruck/Doze)
    // automatisch wieder auf, damit die Bubble nicht dauerhaft verschwindet.
    return START_STICKY
  }

  override fun onDestroy() {
    ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
    stopBubble()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun stopBubble() {
    manager?.hide()
    manager = null
  }

  companion object {
    const val ACTION_STOP = "expo.modules.floatingbubble.ACTION_STOP"
    const val EXTRA_SIZE_DP = "size_dp"

    @Volatile
    var isRunning: Boolean = false
      private set

    fun start(context: Context, sizeDp: Int) {
      val intent = Intent(context, FloatingBubbleService::class.java).apply {
        putExtra(EXTRA_SIZE_DP, sizeDp)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      isRunning = true
    }

    fun stop(context: Context) {
      isRunning = false
      try {
        context.stopService(Intent(context, FloatingBubbleService::class.java))
      } catch (_: Throwable) {
      }
    }
  }
}
