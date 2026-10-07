package com.starsdom.auth

class MemoryTokenStore(var value: String? = null) : TokenStore {
  override fun read() = value
  override fun write(value: String?) { this.value = value }
}
