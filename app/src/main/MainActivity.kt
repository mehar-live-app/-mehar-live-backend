package com.mehar.live

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.ViewGroup

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            val webView = WebView(this)
            webView.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )

            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
            webView.webViewClient = WebViewClient()

            setContentView(webView)
            webView.loadUrl("file:///android_asset/index.html")
        } catch (e: Exception) {
            Log.e("MeharLive", "WebView failed to start", e)
            throw e
        }
    }
}
