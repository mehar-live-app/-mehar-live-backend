package com.mehar.live

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.widget.TextView

class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val message = TextView(this).apply {
            text = "Mehar Live Android Test\n\nAndroid app is running."
            textSize = 22f
            setPadding(32, 32, 32, 32)
        }

        setContentView(message)
    }
}
