import * as React from 'react';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useVideoFile } from './video/VideoSettings';
import { openSelectedFile } from './video/VideoHelpers';

interface FileListProps {
  files: string[];
}

const FileList: React.FC<FileListProps> = ({ files }) => {
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const selectedItemRef = React.useRef<HTMLDivElement>(null);
  const [videoFile] = useVideoFile();

  const handleListItemClick = (index: number) => {
    setSelectedIndex(index);
    openSelectedFile(files[index]);
  };

  React.useEffect(() => {
    const index = files.indexOf(videoFile);
    if (index !== -1) {
      setSelectedIndex(index);
    }
  }, [files, videoFile]);

  React.useEffect(() => {
    if (selectedIndex !== null && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  return (
    <List
      component="nav"
      aria-label="file list"
      sx={{ maxHeight: 300, overflow: 'auto' }}
      dense
    >
      {files.map((file, index) => (
        <ListItemButton
          selected={selectedIndex === index}
          onClick={() => handleListItemClick(index)}
          key={file}
          ref={selectedIndex === index ? selectedItemRef : null}
          dense
          sx={{
            '&.Mui-selected': {
              backgroundColor: '#556cd6',
              color: '#fff',
            },
            '&.Mui-focusVisible': {
              backgroundColor: '#2196f3',
            },
            ':hover': {
              backgroundColor: '#2196f3',
            },
          }}
        >
          <ListItemText primary={file.replace(/.*\//, '')} />
        </ListItemButton>
      ))}
    </List>
  );
};

export default FileList;
