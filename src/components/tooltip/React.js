/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import memoize from 'memoize-immutable';
import * as React from 'react';
import { TooltipDetails, TooltipDetail } from './TooltipDetails';
import { formatMilliseconds } from '../../utils/format-numbers';
import './React.css';

function formatComponentStack(componentStack) {
  const lines = componentStack.split('\n').map(line => line.trim());
  lines.shift();

  if (lines.length > 5) {
    return lines.slice(0, 5).join('\n') + '\n...';
  }
  return lines.join('\n');
}

const getTotalDuration = memoize(
  (data, priority, reactProfilerData) => {
    const { batchUID } = data;
    const work = reactProfilerData[priority].work;

    let startTime = 0;
    let stopTime = Infinity;

    let i = 0;

    for (i; i < work.length; i++) {
      const item = work[i];
      if (item.batchUID === batchUID) {
        startTime = item.timestamp;
        break;
      }
    }

    for (i; i < work.length; i++) {
      const item = work[i];
      stopTime = item.timestamp;
      if (item.batchUID !== batchUID) {
        break;
      }
    }

    return stopTime - startTime;
  },
  {
    limit: 1,
  }
);

export function TooltipReactEvent({ color, data, zeroAt }) {
  const { componentName, componentStack, timestamp, type } = data;

  let label = null;
  switch (type) {
    case 'schedule-render':
      label = 'render scheduled';
      break;
    case 'schedule-state-update':
      label = 'state update scheduled';
      break;
    case 'suspend':
      label = 'suspended';
      break;
    default:
      break;
  }

  return (
    <div className="tooltipMarker">
      <div className="tooltipHeader">
        <div className="tooltipOneLine">
          {componentName && (
            <div className="componentName" style={{ color }}>
              {componentName}&nbsp;
            </div>
          )}
          <div className="tooltipTitle">{label}</div>
        </div>
      </div>
      <TooltipDetails>
        <TooltipDetail label="Timestamp">
          {formatMilliseconds(timestamp - zeroAt)}
        </TooltipDetail>
        {componentStack && (
          <TooltipDetail label="Component stack">
            <pre className="componentStack">
              {formatComponentStack(componentStack)}
            </pre>
          </TooltipDetail>
        )}
      </TooltipDetails>
    </div>
  );
}

export function TooltipReactWork({
  data,
  priority,
  reactProfilerData,
  zeroAt,
}) {
  const { duration, timestamp, type } = data;

  let label = null;
  switch (type) {
    case 'commit-work':
      label = 'commit';
      break;
    case 'render-idle':
      label = 'idle';
      break;
    case 'render-work':
      label = 'render';
      break;
    case 'layout-effects':
      label = 'layout effects';
      break;
    case 'passive-effects':
      label = 'passive effects';
      break;
    default:
      break;
  }

  return (
    <div className="tooltipMarker">
      <div className="tooltipHeader">
        <div className="tooltipOneLine">
          <div className="tooltipTiming">{formatMilliseconds(duration)}</div>
          <div className="tooltipTitle">{label}</div>
        </div>
      </div>
      <TooltipDetails>
        <TooltipDetail label="Timestamp">
          {formatMilliseconds(timestamp - zeroAt)}
        </TooltipDetail>
        <TooltipDetail label="Batch duration">
          {formatMilliseconds(
            getTotalDuration(data, priority, reactProfilerData)
          )}
        </TooltipDetail>
      </TooltipDetails>
    </div>
  );
}
