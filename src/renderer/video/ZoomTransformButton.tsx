import React, { useState } from 'react';
import {
  Box,
  Button,
  Divider,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContrastIcon from '@mui/icons-material/Contrast';
import {
  useGuideHighlight,
  useZoomTransform,
  ZOOM_TRANSFORM_MIN_ZOOM,
} from './VideoSettings';
import { ZOOM_TRANSFORM_LABELS, ZoomTransformMode } from './ZoomTransform';

/**
 * React delivers events from the portaled menu to the video's mouse handlers,
 * where a click zooms; keep them here.
 */
const stopVideoMouse = {
  onClick: (event: React.SyntheticEvent) => event.stopPropagation(),
  onDoubleClick: (event: React.SyntheticEvent) => event.stopPropagation(),
  onMouseDown: (event: React.SyntheticEvent) => event.stopPropagation(),
  onMouseUp: (event: React.SyntheticEvent) => event.stopPropagation(),
  onContextMenu: (event: React.SyntheticEvent) => event.stopPropagation(),
};

const MODES = Object.keys(ZOOM_TRANSFORM_LABELS) as ZoomTransformMode[];

const TOOLTIP = (
  <Box sx={{ fontSize: '0.8rem' }}>
    <b>Zoom transform</b> (display only, at {ZOOM_TRANSFORM_MIN_ZOOM}x zoom or
    more)
    <br />
    Auto-levels stretches the visible brightness range. Water contrast shows how
    far each pixel&apos;s colour is from the water: water goes dark and the
    hull, bow ball and card go bright.
    <ul style={{ margin: '0.3em 0 0', paddingLeft: '1.2em' }}>
      <li>
        Wave glints and dark ripples also show bright, so judge shapes, not
        single bright pixels.
      </li>
      <li>A grey or white hull on grey water shows less contrast.</li>
      <li>
        Water is taken from the visible area; when the view is mostly hull it is
        taken from the edges instead.
      </li>
    </ul>
    Highlight non-water on timing guide marks, behind the timing guide, where it
    crosses something unlike the water, such as the bow.
  </Box>
);

/** Chooses the zoom transform; sits beside the zoom factor button. */
const ZoomTransformButton: React.FC<{ className?: string }> = ({
  className,
}) => {
  const [mode, setMode] = useZoomTransform();
  const [guideHighlight, setGuideHighlight] = useGuideHighlight();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = mode !== 'off' || guideHighlight;

  return (
    // Wraps the menu too: React bubbles portal events through this element.
    <Box
      sx={{ display: 'contents' }}
      onClick={stopVideoMouse.onClick}
      onDoubleClick={stopVideoMouse.onDoubleClick}
      onMouseDown={stopVideoMouse.onMouseDown}
      onMouseUp={stopVideoMouse.onMouseUp}
      onContextMenu={stopVideoMouse.onContextMenu}
    >
      <Tooltip title={TOOLTIP} placement="right">
        <Button
          size="small"
          variant="outlined"
          className={className}
          aria-label={`Zoom transform: ${ZOOM_TRANSFORM_LABELS[mode]}`}
          sx={{
            height: 24,
            m: 0,
            minWidth: 30,
            ...(active && { background: '#ffd54fd0 !important' }),
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setAnchor(event.currentTarget);
          }}
        >
          <ContrastIcon fontSize="small" />
        </Button>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {MODES.map((option) => (
          <MenuItem
            key={option}
            selected={option === mode}
            onClick={() => {
              setMode(option);
              setAnchor(null);
            }}
          >
            <ListItemIcon>
              {option === mode && <CheckIcon fontSize="small" />}
            </ListItemIcon>
            {ZOOM_TRANSFORM_LABELS[option]}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          onClick={() => {
            setGuideHighlight(!guideHighlight);
            setAnchor(null);
          }}
        >
          <ListItemIcon>
            {guideHighlight && <CheckIcon fontSize="small" />}
          </ListItemIcon>
          Highlight non-water on timing guide
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default ZoomTransformButton;
