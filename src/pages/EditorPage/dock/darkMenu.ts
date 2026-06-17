// Shared MUI menu styling, reused across the app. Driven by app-theme tokens so
// every menu re-themes at once. (Name kept for compatibility; it follows the
// active app theme, not just dark.)
export const darkMenuSlotProps = {
  paper: {
    sx: {
      bgcolor: 'var(--app-bg-panel)',
      color: 'var(--app-text-secondary)',
      border: '1px solid var(--app-border-subtle)',
      backgroundImage: 'none',
      '& .MuiMenuItem-root': { fontSize: '0.85rem', '&:hover': { bgcolor: 'var(--app-bg-hover)' }, '&.Mui-disabled': { opacity: 1, color: 'var(--app-text-disabled)' } },
      '& .MuiListItemIcon-root': { color: 'var(--app-text-secondary)', minWidth: 32 },
      '& .MuiListItemText-secondary': { color: 'var(--app-text-disabled)' },
      '& .MuiDivider-root': { borderColor: 'var(--app-border-subtle)' },
      '& .MuiCheckbox-root': { color: 'var(--app-text-disabled)' },
      '& .MuiCheckbox-root.Mui-checked': { color: 'var(--app-accent)' },
    },
  },
} as const;
