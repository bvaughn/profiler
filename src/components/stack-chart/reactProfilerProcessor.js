/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import type { MarkerPayload } from '../../types/markers';
import type {
  BatchUID,
  ReactPriority,
  ReactProfilerData,
  ReactProfilerDataPriority,
} from '../../types/react';

// TODO Combine yields/starts that are closer than some threshold with the previous event to reduce renders.

type Metadata = {|
  nextRenderShouldGenerateNewBatchID: boolean,
  batchUID: BatchUID,
  +stack: Array<any>,
|};

export default function reactProfilerProcessor(
  markerPayload: MarkerPayload
): ReactProfilerData | null {
  // Filter null entries and sort by timestamp.
  // I would not expect to have to do either of this,
  // but some of the data being passed in requires it.
  // $FlowFixMe Flow does not recognize Array methods like .filter()
  markerPayload = markerPayload
    .filter(Boolean)
    .filter(d => d.type === 'UserTiming' && d.name.startsWith('--'))
    .sort((a, b) => (a.startTime > b.startTime ? 1 : -1));

  if (markerPayload.length === 0) {
    return null;
  }

  const reactProfilerData: ReactProfilerData = {
    high: {
      events: [],
      measures: [],
    },
    normal: {
      events: [],
      measures: [],
    },
    low: {
      events: [],
      measures: [],
    },
    unscheduled: {
      events: [],
      measures: [],
    },
  };

  let currentMetadata: Metadata = ((null: any): Metadata);
  let currentPriority: ReactPriority = 'unscheduled';
  let currentProfilerDataGroup: ReactProfilerDataPriority = ((null: any): ReactProfilerDataPriority);
  let uidCounter = 0;

  const metadata = {
    high: {
      nextRenderShouldGenerateNewBatchID: true,
      batchUID: 0,
      stack: [],
    },
    normal: {
      nextRenderShouldGenerateNewBatchID: true,
      batchUID: 0,
      stack: [],
    },
    low: {
      nextRenderShouldGenerateNewBatchID: true,
      batchUID: 0,
      stack: [],
    },
    unscheduled: {
      nextRenderShouldGenerateNewBatchID: true,
      batchUID: 0,
      stack: [],
    },
  };

  const getLastType = () => {
    const { stack } = currentMetadata;
    if (stack.length > 0) {
      const { type } = stack[stack.length - 1];
      return type;
    }
    return null;
  };

  const getDepth = () => {
    const { stack } = currentMetadata;
    if (stack.length > 0) {
      const { depth, type } = stack[stack.length - 1];
      return type === 'render-idle' ? depth : depth + 1;
    }
    return 0;
  };

  const markWorkCompleted = (type, stopTime) => {
    const { stack } = currentMetadata;
    if (stack.length === 0) {
      console.error(
        `Unexpected type "${type}" completed while stack is empty.`
      );
    } else {
      const last = stack[stack.length - 1];
      if (last.type !== type) {
        console.error(
          `Unexpected type "${type}" completed before "${last.type}" completed.`
        );
      } else {
        const { index, startTime } = stack.pop();

        if (currentProfilerDataGroup) {
          const measure = currentProfilerDataGroup.measures[index];
          if (!measure) {
            console.error(
              `Could not find matching measure for type "${type}".`
            );
          } else {
            // $FlowFixMe This property should not be writable outside of this function.
            measure.duration = stopTime - startTime;
          }
        }
      }
    }
  };

  const markWorkStarted = (type, startTime) => {
    const { batchUID, stack } = currentMetadata;

    const index = currentProfilerDataGroup.measures.length;
    const depth = getDepth();

    stack.push({
      depth,
      index,
      startTime,
      type,
    });

    currentProfilerDataGroup.measures.push({
      type,
      batchUID,
      depth,
      priority: currentPriority,
      timestamp: startTime,
      duration: 0,
    });
  };

  const throwIfIncomplete = type => {
    const { stack } = currentMetadata;
    const lastIndex = stack.length - 1;
    if (lastIndex >= 0) {
      const last = stack[lastIndex];
      if (last.stopTime === undefined && last.type === type) {
        throw new Error(
          `Unexpected type "${type}" started before "${last.type}" completed.`
        );
      }
    }
  };

  for (let i = 0; i < markerPayload.length; i++) {
    const currentEvent = markerPayload[i];

    if (
      currentEvent.type !== 'UserTiming' ||
      !currentEvent.name.startsWith('--')
    ) {
      continue;
    }

    currentMetadata = metadata[currentPriority] || metadata.unscheduled;
    if (!currentMetadata) {
      console.error('Unexpected priority', currentPriority);
    }

    currentProfilerDataGroup =
      reactProfilerData[currentPriority || 'unscheduled'];
    if (!currentProfilerDataGroup) {
      console.error('Unexpected priority', currentPriority);
    }

    const { name, startTime } = currentEvent;

    if (name.startsWith('--scheduler-start-')) {
      if (currentPriority !== 'unscheduled') {
        console.error(
          `Unexpected scheduler start: "${name}" with current priority: "${currentPriority}"`
        );
        continue; // TODO Should we throw? Will this corrupt our data?
      }

      currentPriority = ((name.substr(18): any): ReactPriority);
    } else if (name.startsWith('--scheduler-stop-')) {
      if (
        currentPriority === 'unscheduled' ||
        currentPriority !== name.substr(17)
      ) {
        console.error(
          `Unexpected scheduler stop: "${name}" with current priority: "${currentPriority}"`
        );
        continue; // TODO Should we throw? Will this corrupt our data?
      }

      currentPriority = 'unscheduled';
    } else if (name === '--render-start') {
      if (currentMetadata.nextRenderShouldGenerateNewBatchID) {
        currentMetadata.nextRenderShouldGenerateNewBatchID = false;
        currentMetadata.batchUID = ((uidCounter++: any): BatchUID);
      }
      throwIfIncomplete('render');
      if (getLastType() !== 'render-idle') {
        markWorkStarted('render-idle', startTime);
      }
      markWorkStarted('render', startTime);
    } else if (name === '--render-stop') {
      markWorkCompleted('render', startTime);
    } else if (name === '--render-yield') {
      markWorkCompleted('render', startTime);
    } else if (name === '--render-cancel') {
      currentMetadata.nextRenderShouldGenerateNewBatchID = true;
      markWorkCompleted('render', startTime);
      markWorkCompleted('render-idle', startTime);
    } else if (name === '--commit-start') {
      currentMetadata.nextRenderShouldGenerateNewBatchID = true;
      markWorkStarted('commit', startTime);
    } else if (name === '--commit-stop') {
      markWorkCompleted('commit', startTime);
      markWorkCompleted('render-idle', startTime);
    } else if (
      name === '--layout-effects-start' ||
      name === '--passive-effects-start'
    ) {
      const type =
        name === '--layout-effects-start'
          ? 'layout-effects'
          : 'passive-effects';
      throwIfIncomplete(type);
      markWorkStarted(type, startTime);
    } else if (
      name === '--layout-effects-stop' ||
      name === '--passive-effects-stop'
    ) {
      const type =
        name === '--layout-effects-stop' ? 'layout-effects' : 'passive-effects';
      markWorkCompleted(type, startTime);
    } else if (name.startsWith('--schedule-render')) {
      currentProfilerDataGroup.events.push({
        type: 'schedule-render',
        priority: currentPriority, // TODO Change to target priority
        timestamp: startTime,
      });
    } else if (name.startsWith('--schedule-state-update-')) {
      const [componentName, componentStack] = name.substr(24).split('-');
      const isCascading = !!currentMetadata.stack.find(
        ({ type }) => type === 'commit'
      );
      currentProfilerDataGroup.events.push({
        type: 'schedule-state-update',
        priority: currentPriority, // TODO Change to target priority
        isCascading,
        timestamp: startTime,
        componentName,
        componentStack,
      });
    } else if (name.startsWith('--suspend-')) {
      const [componentName, componentStack] = name.substr(10).split('-');
      currentProfilerDataGroup.events.push({
        type: 'suspend',
        priority: currentPriority, // TODO Change to target priority
        timestamp: startTime,
        componentName,
        componentStack,
      });
    }
  }

  Object.entries(metadata).forEach(([priority, metadata]) => {
    const { stack } = ((metadata: any): Metadata);
    if (stack.length > 0) {
      console.error(
        `Incomplete events or measures for priority ${priority}`,
        stack
      );
    }
  });

  return reactProfilerData;
}
