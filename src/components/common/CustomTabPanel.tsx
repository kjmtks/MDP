import { Box } from '@mui/material';
import type { TabPanelProps } from '../../types';

export function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, noScroll, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other} style={{ height: '100%', overflow: 'hidden' }}>
      {value === index && (
        <Box sx={{ height: '100%', overflowY: noScroll ? 'hidden' : 'auto' }}>
          {children}
        </Box>
      )}
    </div>
  );
}