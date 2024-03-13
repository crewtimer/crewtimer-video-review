import * as React from 'react';
import { useSelectedIndex, useVideoFile } from './video/VideoSettings';
import { requestVideoFrame } from './video/VideoFileUtils';
import DataGrid, {
  CellClickArgs,
  CellMouseEvent,
  Column,
  DataGridHandle,
} from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { Box, Tooltip } from '@mui/material';
import { useRef } from 'react';

interface FileListProps {
  height: number;
  files: string[];
}

interface FileInfo {
  id: number;
  filename: string;
}

function rowKeyGetter(row: FileInfo) {
  return row.id;
}

const HeaderRenderer: React.FC<{
  column: Column<any>;
  [key: string]: any;
}> = ({ column, ...props }) => {
  // Strip the sortDirection prop as it is not supported by div.
  const { sortDirection, ...restOfProps } = props;
  return (
    <div {...restOfProps} style={{ fontSize: 12 }}>
      {column.name}
    </div>
  );
};
const FileList: React.FC<FileListProps> = ({ files, height }) => {
  const [selectedIndex, setSelectedIndex] = useSelectedIndex();
  const [videoFile, setVideoFile] = useVideoFile();
  const dataGridRef = useRef<DataGridHandle | null>(null);

  React.useEffect(() => {
    const index = files.indexOf(videoFile);
    if (index !== -1) {
      setSelectedIndex(index);
    }
  }, [files, videoFile]);

  React.useEffect(() => {
    if (files.length === 0) {
      return;
    }
    if (selectedIndex < 0) {
      setSelectedIndex(0);
      setVideoFile(files[0]);
      return;
    } else if (selectedIndex > files.length - 1) {
      setSelectedIndex(files.length - 1);
      setVideoFile(files[files.length - 1]);
      return;
    }
    dataGridRef.current?.scrollToCell({ rowIdx: selectedIndex, idx: 0 });
  }, [selectedIndex]);

  const columns: Column<FileInfo>[] = [
    {
      key: 'name',
      name: 'Filename',
      renderHeaderCell: HeaderRenderer,
      renderCell: ({ row, rowIdx }: { row: FileInfo; rowIdx: number }) => {
        const filename = row.filename.replace(/.*\//, '');
        return (
          <Box
            sx={
              rowIdx === selectedIndex
                ? {
                    fontSize: 12,
                    background: '#19857b',
                    color: 'white',
                    paddingLeft: '0.5em',
                  }
                : { fontSize: 12, paddingLeft: '0.5em' }
            }
          >
            <Tooltip title={filename} placement="left">
              <Box>{filename}</Box>
            </Tooltip>
          </Box>
        );
      },
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
      setVideoFile(dispItems[index]?.filename);
      requestVideoFrame({ videoFile: dispItems[index]?.filename, frameNum: 1 });
      // dataGridRef.current?.scrollToCell({ rowIdx: index, idx: 0 });
    },
    [dispItems]
  );

  return (
    <DataGrid<FileInfo>
      ref={dataGridRef}
      style={{ height: height }}
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
