import { createContext } from 'react'

// Kept apart from the providers so those files only export components
// (needed for fast refresh during development).
export const SavingsContext = createContext(null)
export const ThemeContext = createContext(null)
export const AuthContext = createContext(null)
export const ConfirmContext = createContext(null)
