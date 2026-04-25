'use client'

import { useEffect, useState } from 'react'

interface StoredUser {
  userId: string
  tournamentToken: string
}

export function useCurrentUser(token: string) {
  const [userId, setUserId] = useState<string | null>(null)

  const storageKey = `omojan:user:${token}`

  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      try {
        const parsed: StoredUser = JSON.parse(stored)
        if (parsed.tournamentToken === token) {
          setUserId(parsed.userId)
        }
      } catch {
        localStorage.removeItem(storageKey)
      }
    }
  }, [storageKey, token])

  function saveUser(newUserId: string) {
    const data: StoredUser = { userId: newUserId, tournamentToken: token }
    localStorage.setItem(storageKey, JSON.stringify(data))
    setUserId(newUserId)
  }

  function clearUser() {
    localStorage.removeItem(storageKey)
    setUserId(null)
  }

  return { userId, saveUser, clearUser }
}
