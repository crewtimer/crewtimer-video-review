import React, { useEffect, useRef } from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer, { Size } from 'react-virtualized-auto-sizer';
import makeStyles from '@mui/styles/makeStyles';
import { Typography } from '@mui/material';
import clsx from 'clsx';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import { Lap } from 'crewtimer-common';
import { setEntryResultAndPublish, useLaps } from './util/LapStorageDatum';

export const colors = {
  deleted: '#808081',
  generic: '#9933ff',
  default: '#2233aa',
  modified: '#000080',
  txpend: '#ff8c00',
  txfail: '#cc0000',
  unassignedBorder: '#ff0',
};
const useStyles = makeStyles({
  root: {
    flex: 1,
    display: 'flex',
    flexFlow: 'column',
    marginBottom: '2em',
  },
  list: {},
  even: {
    backgroundColor: '#f0f0f0',
  },
  odd: {},
  common: {},
  tsline: {
    flexDirection: 'row',
    display: 'flex',
    alignItems: 'stretch',
    borderBottom: '1px solid #e0e0e0',
    paddingLeft: 8,
  },
  index: { flexGrow: 5, flexBasis: 0 },
  gate: { flexGrow: 8, flexBasis: 0 },
  event: { flexGrow: 4, flexBasis: 0 },
  bow: { flexGrow: 4, flexBasis: 0 },
  time: { flexGrow: 8, flexBasis: 0 },
  status: {
    flexGrow: 6,
    flexBasis: 0,
    marginLeft: 8,
    paddingRight: 8,
  },
  trash: { flexGrow: 4, flexBasis: 0, color: '#666' },
  bold: { fontWeight: 'bold' },

  strike: { textDecorationLine: 'line-through', color: '#888' },
  OK: {},
  TxPend: { color: colors.txpend },
  TxActive: { color: colors.txpend },
  Fail: { color: colors.txfail },
});

interface Dataset {
  laps: Lap[];
  renderCount: number;
}

const Row = ({ data, index, style }: ListChildComponentProps) => {
  const classes = useStyles();
  const lap = data.laps[index] as Lap;
  const { PenaltyCode, Gate, EventNum, Bow, Status, Time, State } = lap;
  let gate = Gate?.replace(/^G_/, '')
    .replace(/^S$/, 'Start')
    .replace(/^F$/, 'Finish');
  if (gate === 'Pen' && PenaltyCode) {
    gate = PenaltyCode;
  }
  const strike = State === 'Deleted' ? classes.strike : '';

  const onDeleteClicked = () => {
    if (State === 'Deleted') {
      delete lap.State;
    } else {
      lap.State = 'Deleted';
    }
    setEntryResultAndPublish(lap.keyid || lap.uuid, lap);
  };

  return (
    // index % 2 ? classes.odd : classes.even}
    <div style={style}>
      <div
        className={clsx(classes.tsline, index % 2 ? classes.odd : classes.even)}
      >
        <Typography
          noWrap
          className={clsx(classes.common, classes.index, strike)}
        >
          {index + 1}
        </Typography>
        <Typography
          noWrap
          className={clsx(classes.common, classes.gate, strike)}
        >
          {gate}
        </Typography>
        <Typography noWrap className={clsx(classes.event, strike)}>
          {EventNum}
        </Typography>
        <Typography noWrap className={clsx(classes.bow, strike)}>
          {Bow}
        </Typography>
        <Typography align="right" className={clsx(classes.time, strike)}>
          {Time}
        </Typography>
        <Typography
          noWrap
          align="right"
          className={clsx(classes.status, classes[Status || 'OK'], strike)}
        >
          {Status}
        </Typography>
        <DeleteForeverOutlinedIcon
          onClick={onDeleteClicked}
          className={classes.trash}
        />
      </div>
    </div>
  );
};

let renderCount = 0;
const LapListImpl = ({ height, width }: Size) => {
  const classes = useStyles();
  const listRef = useRef<List>();
  const [laps] = useLaps();

  useEffect(() => {
    const ref = listRef.current;
    if (ref) {
      ref.scrollToItem(laps.length);
    }
  }, [listRef, laps.length]);

  // Assume any render needs to redraw list by creating a new wrapper object.
  // The only other option would be to keep track of which row changed and
  // have Row refresh on that
  renderCount += 1;
  const dataset: Dataset = { laps, renderCount };

  return laps.length === 0 ? (
    <Typography style={{ width }}>No Data Available</Typography>
  ) : (
    <List
      className={classes.list}
      height={height}
      itemData={dataset}
      itemCount={dataset.laps.length}
      itemSize={35}
      width={width}
      ref={listRef as React.RefObject<List>}
    >
      {Row}
    </List>
  );
};

const LapList = () => {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <div className={clsx(classes.tsline)}>
        <Typography
          className={clsx(classes.common, classes.index, classes.bold)}
        >
          Index
        </Typography>
        <Typography
          className={clsx(classes.common, classes.gate, classes.bold)}
        >
          Waypoint
        </Typography>
        <Typography className={clsx(classes.event, classes.bold)}>
          Event
        </Typography>
        <Typography className={clsx(classes.bow, classes.bold)}>Bow</Typography>
        <Typography align="right" className={clsx(classes.time, classes.bold)}>
          Time
        </Typography>
        <Typography
          align="right"
          className={clsx(classes.time, classes.status, classes.bold)}
        >
          Status
        </Typography>
        <div className={classes.trash} />
      </div>
      <AutoSizer>
        {({ width, height }) => <LapListImpl width={width} height={height} />}
      </AutoSizer>
    </div>
  );
};

export default LapList;
