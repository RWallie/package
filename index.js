import React, {useState, useEffect} from 'react';
import {
  useRecoilTransactionObserver_UNSTABLE,
  useRecoilSnapshot,
  useGotoRecoilSnapshot,
  useRecoilState,
  useGetRecoilValueInfo_UNSTABLE
} from 'recoil';
import {formatFiberNodes} from './formatFiberNodes';

// grabs isPersistedState from sessionStorage
let isPersistedState = sessionStorage.getItem('isPersistedState');

// isRestored state disables snapshots from being recorded
// when we jump backwards
let isRestoredState = false;

// set default throttle to 70, throttle timer changes with every snapshot
let throttleTimer = 0;
let throttleLimit = 70;

// persistedSnapshots initially null
// let persistedSnapshots = null;

// declare message to send with array of atoms and array of selectors
// let atomsAndSelectorsMsg;    

// define a boolean that determins whether the names of atoms and selectors have been sent to the extension App
// reused on line 152
let sentAtomsAndSelectors = false;

// assign the value of selectorsObject in formatRecoilizeSelectors function
// will contain the selectors from a user application
let selectorsObject = "yes finally"; 

export default function RecoilizeDebugger(props) {

  // We should ask for Array of atoms and selectors.
  // Captures all atoms that were defined to get the initial state

  // Define a recoilizeRoot variable which will be assigned based on whether a root is passed in as a prop
  let recoilizeRoot;

  // Check if a root was passed to props.
  if (props.root) {
    const {root} = props;
    recoilizeRoot = root;
  } else {
    recoilizeRoot = document.getElementById('root');
  }

  const snapshot = useRecoilSnapshot();

  // getNodes_UNSTABLE will return an iterable that contains atom and selector objects.
  const nodes = [...snapshot.getNodes_UNSTABLE()];
  // Local state of all previous snapshots to use for time traveling when requested by dev tools.
  const [snapshots, setSnapshots] = useState([snapshot]);
  // const [isRestoredState, setRestoredState] = useState(false);
  const gotoSnapshot = useGotoRecoilSnapshot();

  const filteredSnapshot = {};

  /*
  A nodeDeps object is constructed using getDeps_UNSTABLE. 
  This object will then be used to construct a nodeSubscriptions object. 
  After continuous testing, getSubscriptions_UNSTABLE was deemed too unreliable. 
  */

  const nodeDeps = {};
  const nodeSubscriptions = {};

  nodes.forEach(node => {
    const getDeps = [...snapshot.getInfo_UNSTABLE(node).deps];
    nodeDeps[node.key] = getDeps.map(dep => dep.key);
  });

  for (let key in nodeDeps) {
    nodeDeps[key].forEach(node => {
      if (nodeSubscriptions[node]) {
        nodeSubscriptions[node].push(key);
      } else {
        nodeSubscriptions[node] = [key];
      }
    });
  }

  // Traverse all atoms and selector state nodes and get value
  nodes.forEach((node, index) => {
    const type = node.__proto__.constructor.name;
    const contents = snapshot.getLoadable(node).contents;
    // Construct node data structure for dev tool to consume
    filteredSnapshot[node.key] = {
      type,
      contents,
      nodeDeps: nodeDeps[node.key],
      nodeToNodeSubscriptions: nodeSubscriptions[node.key]
        ? nodeSubscriptions[node.key]
        : [],
    };
  });
  
  // React lifecycle hook on re-render
  useEffect(() => {
    // Window listener for messages from dev tool UI & background.js
    window.addEventListener('message', onMessageReceived);

    if (!isRestoredState) {
      const devToolData = createDevToolDataObject(filteredSnapshot);
      // Post message to content script on every re-render of the developers application only if content script has started
      sendWindowMessage('recordSnapshot', devToolData);
    } else {
      isRestoredState = false;
    }

    // Clears the window event listener.
    return () => window.removeEventListener('message', onMessageReceived);
  });

  // Listener callback for messages sent to windowf
  const onMessageReceived = msg => {
    // Add other actions from dev tool here
    switch (msg.data.action) {
      // Checks to see if content script has started before sending initial snapshot
      case 'contentScriptStarted':
        if (isPersistedState === 'false' || isPersistedState === null) {
          const initialFilteredSnapshot = formatAtomSelectorRelationship(
            filteredSnapshot,
          );
          // console.log('SELECTOR OBJECT!!: ', selectorsObject);
          // once application renders, grab the array of atoms and array of selectors
          const appsKnownAtomsArray = [...snapshot._store.getState().knownAtoms]
          // console.log('Store State.getState: Atoms', appsKnownAtomsArray);
          const appsKnownSelectorsArray = [...snapshot._store.getState().knownSelectors]
          // console.log('Store State.getState: Selectors', appsKnownSelectorsArray);
  
          const atomsAndSelectorsMsg = {
            atoms: appsKnownAtomsArray,
            selectors: appsKnownSelectorsArray,
            $selectors: selectorsObject         // the selectors object that contain key and set / get methods as strings
          }

          // console.log('message we are trying to send from index.js of package: ', atomsAndSelectorsMsg);
          // chrome.storage.local.set({
          //   will: 'hi',
          //   ryan: 'hello'
          // });
          // chrome.get();
          // console.log('CHROME.STORAGE.LOCAL: ', chrome);

          //creating a indexDiff variable
          //only created on initial creation of devToolData
          //determines difference in length of backend snapshots array and frontend snapshotHistoryLength to avoid off by one error
          const indexDiff = snapshots.length - 1;

          const devToolData = createDevToolDataObject(
            initialFilteredSnapshot,
            indexDiff,
            atomsAndSelectorsMsg,
          );
          sendWindowMessage('moduleInitialized', devToolData);
        } else {
          setProperIndexForPersistedState();
          sendWindowMessage('persistSnapshots', null);
        }

        // check if the atoms and selectors have already been sent
        // will only be sent on component did mount (first useEffect trigger)
        // // send over the arrays of atoms and selectors as a window message for the application to listen to
        // if (!sentAtomsAndSelectors){
        //   sendWindowMessage('initialArrayOfAtomsAndSelectors', atomsAndSelectorsMsg);
        //   sentAtomsAndSelectors = true;
        // }
        
        break;
      // Listens for a request from dev tool to time travel to previous state of the app.
      case 'snapshotTimeTravel':
        timeTravelToSnapshot(msg);
        break;
      case 'persistState':
        switchPersistMode();
        break;
      // Implementing the throttle change
      case 'throttleEdit':
        throttleLimit = parseInt(msg.data.payload.value);
        break;
      default:
        break;
    }
  };

  // assigns or switches isPersistedState in sessionStorage
  const switchPersistMode = () => {
    if (isPersistedState === 'false' || isPersistedState === null) {
      // switch isPersistedState in sessionStorage to true
      sessionStorage.setItem('isPersistedState', true);

      // stores the length of current list of snapshots in sessionStorage
      sessionStorage.setItem('persistedSnapshots', snapshots.length);
    } else {
      // switch isPersistedState in sessionStorage to false
      sessionStorage.setItem('isPersistedState', false);
    }
  };

  // function retreives length and fills snapshot array
  const setProperIndexForPersistedState = () => {
    const retreived = sessionStorage.getItem('persistedSnapshots');
    const snapshotsArray = new Array(Number(retreived) + 1).fill({});
    setSnapshots(snapshotsArray);
  };

  // Sends window an action and payload message.
  const sendWindowMessage = (action, payload) => {
    window.postMessage(
      JSON.parse(JSON.stringify({
        action,
        payload,
      })),
      '*',
    );
  };

  const createDevToolDataObject = (filteredSnapshot, diff, atomsAndSelectors) => {
    if (diff === undefined) {
      return {
        filteredSnapshot: filteredSnapshot,
        componentAtomTree: formatFiberNodes(
          recoilizeRoot._reactRootContainer._internalRoot.current,
        ),
        atomsAndSelectors,
      };
    } else {
      return {
        filteredSnapshot: filteredSnapshot,
        componentAtomTree: formatFiberNodes(
          recoilizeRoot._reactRootContainer._internalRoot.current,
        ),
        indexDiff: diff,
        atomsAndSelectors,
      };
    }
  };

  const formatAtomSelectorRelationship = filteredSnapshot => {
    if (
      window.$recoilDebugStates &&
      Array.isArray(window.$recoilDebugStates) &&
      window.$recoilDebugStates.length
    ) {
      let snapObj =
        window.$recoilDebugStates[window.$recoilDebugStates.length - 1];
      if (snapObj.hasOwnProperty('nodeDeps')) {
        for (let [key, value] of snapObj.nodeDeps) {
          filteredSnapshot[key].nodeDeps = Array.from(value);
        }
      }
      if (snapObj.hasOwnProperty('nodeToNodeSubscriptions')) {
        for (let [key, value] of snapObj.nodeToNodeSubscriptions) {
          filteredSnapshot[key].nodeToNodeSubscriptions = Array.from(value);
        }
      }
    }
    return filteredSnapshot;
  };

  // Will add hover effect over highlighted component
  // Takes an argument of msg.data which contains name and payload
  const activateHover = payload => {
    let name = payload.name;
  };

  // FOR TIME TRAVEL: time travels to a given snapshot, re renders application.
  const timeTravelToSnapshot = async msg => {
    // await setRestoredState(true);
    // await gotoSnapshot(snapshots[msg.data.payload.snapshotIndex]);
    // await setRestoredState(false);
    isRestoredState = true;
    await gotoSnapshot(snapshots[msg.data.payload.snapshotIndex]);
  };

  // FOR TIME TRAVEL: Recoil hook to fire a callback on every atom/selector change -- research Throttle
  useRecoilTransactionObserver_UNSTABLE(({snapshot}) => {
    const now = new Date().getTime();
    if (now - throttleTimer < throttleLimit) {
      isRestoredState = true;
    } else {
      throttleTimer = now;
    }

    if (!isRestoredState) {
      setSnapshots([...snapshots, snapshot]);
    }
  });

  return null;
}

// function that receives objects to be passed into selector constructor function to post a message to the window
// cannot send an object with a property that contains a function to the window - need to stringify the set and get methods
export function formatRecoilizeSelectors(...selectors){
  // create object to be sent via window message from target recoil application
  selectorsObject = {};
  // iterate through our array of objects
  selectors.forEach(selector => {
    // check if the current selector object contains a set method, if so, reassign it to a stringified version
    if (selector.hasOwnProperty('set')){
      selector.set = selector.set.toString();
    }
    // check if the current selector object contains a get method, if so, reassign it to a stringified version
    if (selector.hasOwnProperty('get')){
      selector.get = selector.get.toString();
    }
    // store the selector in the payload object - providing its property name as the 'key' property of the current selector object
    // providing the object the property name of selector key will give easy searchability in GUI application for selector dropdown
    selectorsObject[selector.key] = selector;
  });

  //console.log("selectorsObject: ", selectorsObject);
  //console.log("selectorsObject.payload: ", selectorsObject.payload);

  // return window post message passing in selectorsObject
  //setTimeout(() => window.postMessage(selectorsObject, '*'), 2000)
  //return window.postMessage(selectorsObject, '*');
}


