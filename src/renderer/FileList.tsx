import * as React from 'react';
import { useSelectedIndex, useVideoFile } from './video/VideoSettings';
import { openSelectedFile } from './video/VideoHelpers';
import DataGrid, {
  CellClickArgs,
  CellMouseEvent,
  Column,
  DataGridHandle,
} from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { Box } from '@mui/material';
import { useRef } from 'react';

interface FileListProps {
  files: string[];
}

interface FileInfo {
  id: number;
  filename: string;
}

function rowKeyGetter(row: FileInfo) {
  return row.id;
}

const FileList: React.FC<FileListProps> = ({ files }) => {
  const [selectedIndex, setSelectedIndex] = useSelectedIndex();
  const [videoFile] = useVideoFile();
  const dataGridRef = useRef<DataGridHandle | null>(null);

  React.useEffect(() => {
    const index = files.indexOf(videoFile);
    if (index !== -1) {
      setSelectedIndex(index);
    }
  }, [files, videoFile]);

  React.useEffect(() => {
    console.log(`Selected index=${selectedIndex}, files.leng=${files.length}`);
    if (files.length === 0) {
      return;
    }
    if (selectedIndex < 0) {
      setSelectedIndex(0);
      return;
    }
    if (selectedIndex > files.length - 1) {
      setSelectedIndex(files.length - 1);
      return;
    }
    openSelectedFile(files[selectedIndex]);
    dataGridRef.current?.scrollToCell({ rowIdx: selectedIndex, idx: 0 });
  }, [selectedIndex]);

  const columns: Column<FileInfo>[] = [
    {
      key: 'name',
      name: 'Filename',
      renderCell: ({ row, rowIdx }: { row: FileInfo; rowIdx: number }) => (
        <Box
          sx={
            rowIdx === selectedIndex
              ? { background: '#556cd6', color: 'white', paddingLeft: '0.5em' }
              : { paddingLeft: '0.5em' }
          }
        >
          {row.filename.replace(/.*\//, '')}
        </Box>
      ),
    },
  ];

  const dispItems = React.useMemo(
    () => files.map((filename, index) => ({ id: index, filename })),
    [files]
  );

  const handleClick = React.useCallback(
    (args: CellClickArgs<FileInfo, unknown>, event: CellMouseEvent) => {
      event.preventGridDefault();
      const index = args.row.id;
      setSelectedIndex(index);
      // openSelectedFile(files[index]);
      // dataGridRef.current?.scrollToCell({ rowIdx: index, idx: 0 });
    },
    []
  );

  return (
    <DataGrid<FileInfo>
      ref={dataGridRef}
      style={{ height: '300px' }}
      rowHeight={30}
      columns={columns}
      rows={dispItems}
      rowKeyGetter={rowKeyGetter}
      onCellClick={handleClick}
      onCellDoubleClick={handleClick}
    />
  );
};

export default FileList;
