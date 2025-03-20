import React, { useRef } from 'react';
import { UseDatum } from 'react-usedatum';
import { Box, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import DataGrid, {
  CellClickArgs,
  CellMouseEvent,
  Column,
  DataGridHandle,
} from 'react-data-grid';
import {
  getVideoDir,
  useSelectedIndex,
  useVideoFile,
} from './video/VideoSettings';
import {
  getDirList,
  refreshDirList,
  requestVideoFrame,
} from './video/VideoFileUtils';

import 'react-data-grid/lib/styles.css';
import { setDialogConfig } from './util/ConfirmDialog';
import { showErrorDialog } from './util/ErrorDialog';
import { replaceFileSuffix } from './util/Util';
import { moveToFileIndex } from './video/VideoUtils';

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars, react/prop-types
  const { sortDirection, ...restOfProps } = props;
  return (
    // eslint-disable-next-line react/jsx-props-no-spreading
    <div {...restOfProps} style={{ fontSize: 12 }}>
      {column.name}
    </div>
  );
};
const [useContextMenuAnchor, setContextMenuAnchor] = UseDatum<{
  element: Element;
  row: FileInfo;
} | null>(null);

const ContextMenu: React.FC = () => {
  const [anchorEl] = useContextMenuAnchor();

  const [selectedIndex] = useSelectedIndex();
  const handleClose = () => {
    setContextMenuAnchor(null);
  };
  const onDelete = () => {
    handleClose();
    const row = anchorEl?.row;
    const filename = row?.filename;
    if (!filename) {
      return;
    }
    setDialogConfig({
      title: 'Delete File',
      message: `Permanently delete '${row.filename}'?`,
      button: 'Delete',
      showCancel: true,
      handleConfirm: () => {
        console.log(
          `delete ${filename} selectedIndex: ${selectedIndex} id: ${row.id}`,
        );
        let delay = 10;
        if (selectedIndex === row.id) {
          moveToFileIndex(
            row.id === getDirList().length - 1 ? row.id - 1 : row.id + 1,
            0,
            false,
          );
          delay = 500; // wait for file switch to occur.
        }
        setTimeout(async () => {
          let result = await window.Util.deleteFile(
            replaceFileSuffix(row.filename, 'json'),
          ).catch((_e) => {
            /* ignore */
          });
          result = await window.Util.deleteFile(row.filename).catch((e) =>
            showErrorDialog(e),
          );

          if (result && result.error) {
            showErrorDialog(result.error);
          } else {
            await refreshDirList(getVideoDir());
          }
        }, delay);
      },
    });
  };
  return (
    <Menu
      id="row-context-menu"
      anchorEl={anchorEl?.element}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      keepMounted
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      open={anchorEl !== null}
      onClose={handleClose}
    >
      <MenuItem onClick={onDelete}>Delete</MenuItem>
    </Menu>
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
  }, [files, videoFile, setSelectedIndex]);

  React.useEffect(() => {
    if (files.length === 0) {
      return;
    }
    if (selectedIndex < 0) {
      setSelectedIndex(0);
      setVideoFile(files[0]);
      return;
    }
    if (selectedIndex > files.length - 1) {
      setSelectedIndex(files.length - 1);
      setVideoFile(files[files.length - 1]);
      return;
    }
    dataGridRef.current?.scrollToCell({ rowIdx: selectedIndex, idx: 0 });
  }, [files, selectedIndex, setSelectedIndex, setVideoFile]);

  const columns: Column<FileInfo>[] = [
    {
      key: 'name',
      name: 'Filename',
      renderHeaderCell: HeaderRenderer,
      renderCell: ({ row, rowIdx }) => {
        const filename = row.filename.replace(/.*[/\\]/, '');
        return (
          <Box
            sx={
              rowIdx === selectedIndex
                ? {
                    fontSize: 10,
                    background: '#19857b',
                    color: 'white',
                    paddingLeft: '0.25em',
                  }
                : {
                    fontSize: 10,
                    paddingLeft: '0.25em',
                  }
            }
          >
            <Tooltip title={filename} placement="left">
              <Box>{replaceFileSuffix(filename, '')}</Box>
            </Tooltip>
          </Box>
        );
      },
    },
  ];

  const dispItems = React.useMemo(
    () => files.map((filename, index) => ({ id: index, filename })),
    [files],
  );

  const handleClick = React.useCallback(
    (args: CellClickArgs<FileInfo, unknown>, event: CellMouseEvent) => {
      event.preventGridDefault();
      event.preventDefault();
      const index = args.row.id;
      setSelectedIndex(index);
      const filename = dispItems[index]?.filename || 'Unkown';
      setVideoFile(filename);
      requestVideoFrame({ videoFile: filename, frameNum: 1 });
      // dataGridRef.current?.scrollToCell({ rowIdx: index, idx: 0 });
    },
    [dispItems, setSelectedIndex, setVideoFile],
  );

  const handleContextMenu = React.useCallback(
    (args: CellClickArgs<FileInfo, unknown>, event: CellMouseEvent) => {
      console.log('context');
      event.preventGridDefault();
      event.preventDefault();
      setContextMenuAnchor({ element: event.currentTarget, row: args.row });
    },
    [],
  );

  return (
    <>
      <ContextMenu />
      {dispItems.length === 0 ? (
        <Typography>No video files</Typography>
      ) : (
        <DataGrid<FileInfo>
          ref={dataGridRef}
          style={{ height }}
          rowHeight={20}
          columns={columns}
          rows={dispItems}
          rowKeyGetter={rowKeyGetter}
          onCellClick={handleClick}
          onCellDoubleClick={handleClick}
          onCellContextMenu={handleContextMenu}
        />
      )}
    </>
  );
};

export default FileList;
