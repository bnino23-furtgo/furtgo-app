package expo.modules.floatingbubble

import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import kotlin.math.abs

class FloatingBubbleManager(private val context: Context) {

  private val windowManager: WindowManager =
    context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var bubbleView: View? = null
  private var layoutParams: WindowManager.LayoutParams? = null

  fun show(sizeDp: Int = DEFAULT_SIZE_DP) {
    if (bubbleView != null) return

    val sizePx = dpToPx(sizeDp)
    val container = FrameLayout(context).apply {
      val padding = dpToPx(4)
      setPadding(padding, padding, padding, padding)
    }

    val image = ImageView(context).apply {
      val iconDrawable = context.packageManager.getApplicationIcon(context.packageName)
      setImageDrawable(iconDrawable)
      scaleType = ImageView.ScaleType.CENTER_CROP
      val ringPx = dpToPx(2)
      val bg = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.WHITE)
        setStroke(ringPx, Color.parseColor("#1a1a2e"))
      }
      background = bg
      clipToOutline = true
      elevation = dpToPx(8).toFloat()
    }

    container.addView(
      image,
      FrameLayout.LayoutParams(sizePx, sizePx, Gravity.CENTER)
    )

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = screenWidth() - sizePx - dpToPx(16)
      y = dpToPx(160)
    }

    attachTouchHandler(container, params)

    container.setOnClickListener { launchHostApp() }

    windowManager.addView(container, params)
    bubbleView = container
    layoutParams = params
  }

  fun hide() {
    bubbleView?.let {
      try {
        windowManager.removeView(it)
      } catch (_: Throwable) {
        // already detached
      }
    }
    bubbleView = null
    layoutParams = null
  }

  private fun attachTouchHandler(view: View, params: WindowManager.LayoutParams) {
    val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    var initialX = 0
    var initialY = 0
    var initialTouchX = 0f
    var initialTouchY = 0f

    view.setOnTouchListener { v, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          initialTouchX = event.rawX
          initialTouchY = event.rawY
          true
        }
        MotionEvent.ACTION_MOVE -> {
          params.x = (initialX + (event.rawX - initialTouchX)).toInt()
          params.y = (initialY + (event.rawY - initialTouchY)).toInt()
          try {
            windowManager.updateViewLayout(v, params)
          } catch (_: Throwable) {
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          val dx = abs(event.rawX - initialTouchX)
          val dy = abs(event.rawY - initialTouchY)
          if (dx < touchSlop && dy < touchSlop) {
            v.performClick()
          } else {
            snapToEdge(v, params)
          }
          true
        }
        else -> false
      }
    }
  }

  private fun snapToEdge(view: View, params: WindowManager.LayoutParams) {
    val screenW = screenWidth()
    val viewWidth = view.width.takeIf { it > 0 } ?: dpToPx(DEFAULT_SIZE_DP)
    val targetX = if (params.x + viewWidth / 2 < screenW / 2) 0 else screenW - viewWidth

    val animator = ValueAnimator.ofInt(params.x, targetX).apply {
      duration = 220
      addUpdateListener {
        params.x = it.animatedValue as Int
        try {
          windowManager.updateViewLayout(view, params)
        } catch (_: Throwable) {
          cancel()
        }
      }
    }
    animator.start()
  }

  private fun launchHostApp() {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    context.startActivity(intent)
  }

  private fun screenWidth(): Int = context.resources.displayMetrics.widthPixels

  private fun dpToPx(dp: Int): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP,
    dp.toFloat(),
    context.resources.displayMetrics
  ).toInt()

  companion object {
    const val DEFAULT_SIZE_DP = 56
  }
}
