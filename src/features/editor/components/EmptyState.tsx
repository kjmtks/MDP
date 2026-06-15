import React from 'react';
import { Box, Typography } from '@mui/material';

export const EmptyState: React.FC = React.memo(() => (
  <Box sx={{
    height: '100%', width: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', bgcolor: '#202020', color: '#888', gap: 2
  }}>
    <Typography variant="h5" color="#ccc">No File Selected</Typography>
    <Typography variant="body2">Select a file from the list on the left to start editing.</Typography>
  </Box>
));