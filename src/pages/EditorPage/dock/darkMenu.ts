export const darkMenuSlotProps = {
  paper: {
    sx: {
      bgcolor: '#252526',
      color: '#cccccc',
      border: '1px solid #3c3c3c',
      backgroundImage: 'none',
      '& .MuiMenuItem-root': { fontSize: '0.85rem', '&:hover': { bgcolor: '#2a2d2e' }, '&.Mui-disabled': { opacity: 1, color: '#8ba0b2' } },
      '& .MuiListItemIcon-root': { color: '#cccccc', minWidth: 32 },
      '& .MuiListItemText-secondary': { color: '#8ba0b2' },
      '& .MuiDivider-root': { borderColor: '#3c3c3c' },
      '& .MuiCheckbox-root': { color: '#8ba0b2' },
      '& .MuiCheckbox-root.Mui-checked': { color: '#3b82f6' },
    },
  },
} as const;
