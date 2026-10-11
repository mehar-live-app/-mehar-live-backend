package com.mehar.live

import android.app.Activity
import android.os.Bundle
import android.widget.TextView
import android.view.Gravity

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val message = TextView(this).apply {
            text = "Mehar Live Android Test - App Working!"
            textSize = 22f
            gravity = Gravity.CENTER
            setPadding(32, 32, 32, 32)
        }
        setContentView(message)
    }
}
