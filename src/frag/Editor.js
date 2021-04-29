import React, { useState } from "react";
import { useEffect, useRef } from "react";
import { useAnimationFrame } from "./utils";

let Ammo = window.Ammo;

const THREE = require("three");
const qs = require("query-string");
var cloneDeep = require("lodash.clonedeep");

var _ = require("lodash");

let tmpTrans = null;

// const DISTANCE_UNIT = ["mm", "m", "cm", "inch", "foot"];

// function distanceToMeter(v, u) {
//   if (u == "mm") return v / 1000;
//   if (u == "m") return v;
//   if (u == "cm") return v / 100;
//   if (u == "inch") return 2.54 / 100;
//   if (u == "foot") return v * 0.3048;
//   return v;
// }

function init(canvas) {
  let camera, scene, renderer;

  scene = new THREE.Scene();

  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setSize(window.innerWidth - 300, window.innerHeight);

  ///
  //create the scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd1e5);

  //create camera
  camera = new THREE.PerspectiveCamera(
    70,
    (window.innerWidth - 300) / window.innerHeight,
    0.2,
    5000
  );
  camera.position.set(0, 1.7, 4);
  camera.lookAt(new THREE.Vector3(0, 1.7, 0));

  //Add hemisphere light
  let hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.1);
  hemiLight.color.setHSL(0.6, 0.6, 0.6);
  hemiLight.groundColor.setHSL(0.1, 1, 0.4);
  hemiLight.position.set(0, 50, 0);
  scene.add(hemiLight);

  //Add directional light
  let dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.color.setHSL(0.1, 1, 0.95);
  dirLight.position.set(-1, 1.75, 1);
  dirLight.position.multiplyScalar(100);
  scene.add(dirLight);

  dirLight.castShadow = true;

  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;

  let d = 50;

  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;

  dirLight.shadow.camera.far = 13500;

  renderer.setClearColor(0xbfd1e5);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth - 300, window.innerHeight);

  renderer.gammaInput = true;
  renderer.gammaOutput = true;

  renderer.shadowMap.enabled = true;

  return { camera, scene, renderer };
}

function createBlock({ physicsWorld, scene }) {
  let pos = { x: 0, y: -1, z: 0 };
  let scale = { x: 20, y: 2, z: 20 };
  let quat = { x: 0, y: 0, z: 0, w: 1 };
  let mass = 0;

  //threeJS Section
  let blockPlane = new THREE.Mesh(
    new THREE.BoxBufferGeometry(),
    new THREE.MeshPhongMaterial({ color: 0xa0afa4 })
  );

  blockPlane.position.set(pos.x, pos.y, pos.z);
  blockPlane.scale.set(scale.x, scale.y, scale.z);

  blockPlane.castShadow = true;
  blockPlane.receiveShadow = true;

  scene.add(blockPlane);

  //Ammojs Section
  let transform = new Ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));
  transform.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));
  let motionState = new Ammo.btDefaultMotionState(transform);

  let colShape = new Ammo.btBoxShape(
    new Ammo.btVector3(scale.x * 0.5, scale.y * 0.5, scale.z * 0.5)
  );
  colShape.setMargin(0.05);

  let localInertia = new Ammo.btVector3(0, 0, 0);
  colShape.calculateLocalInertia(mass, localInertia);

  let rbInfo = new Ammo.btRigidBodyConstructionInfo(
    mass,
    motionState,
    colShape,
    localInertia
  );
  let body = new Ammo.btRigidBody(rbInfo);

  physicsWorld.addRigidBody(body);
}

function resetRigidBodies({ physicsWorld, scene, rigidBodies }) {
  for (let i = 0; i < rigidBodies.length; i++) {
    let objThree = rigidBodies[i];
    let objAmmo = objThree.userData.physicsBody;

    physicsWorld.removeRigidBody(objAmmo);
    try {
      Ammo.destroy(objAmmo.getCollisionShape());
      Ammo.destroy(objAmmo.getMotionState());
      Ammo.destroy(objAmmo);
    } catch (e) {
      console.error(e);
    }

    scene.remove(objThree);
  }
  rigidBodies.length = 0;
}

function createDrone({ physicsWorld, scene, rigidBodies, droneData }) {
  let pos = { x: 0, y: 5, z: 0 };

  let quat = { x: 0, y: 0, z: 0, w: 1 };
  let mass = droneData.totalMass / 1000;

  let ball = new THREE.Group();
  if (droneData.type === "quadrotor +") {
    let radius = 2 / 100;
    let mcd_meters = droneData.motorCenterDistance / 1000;
    let ball1 = new THREE.Mesh(
      new THREE.SphereBufferGeometry(radius),
      new THREE.MeshPhongMaterial({ color: 0xff0505 })
    );
    ball1.position.set(mcd_meters, 0, 0);

    let ball2 = new THREE.Mesh(
      new THREE.SphereBufferGeometry(radius),
      new THREE.MeshPhongMaterial({ color: 0xff0505 })
    );
    ball2.position.set(-mcd_meters, 0, 0);

    let ball3 = new THREE.Mesh(
      new THREE.SphereBufferGeometry(radius),
      new THREE.MeshPhongMaterial({ color: 0xff0505 })
    );
    ball3.position.set(0, 0, -mcd_meters);

    let ball4 = new THREE.Mesh(
      new THREE.SphereBufferGeometry(radius),
      new THREE.MeshPhongMaterial({ color: 0xff0505 })
    );
    ball4.position.set(0, 0, mcd_meters);

    ball.add(ball1);
    ball.add(ball2);
    ball.add(ball3);
    ball.add(ball4);
  }

  ball.position.set(pos.x, pos.y, pos.z);

  ball.castShadow = true;
  ball.receiveShadow = true;

  scene.add(ball);

  //Ammojs Section
  let transform = new Ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));
  transform.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));
  let motionState = new Ammo.btDefaultMotionState(transform);

  let colShape = new Ammo.btSphereShape(droneData.motorCenterDistance / 1000);
  colShape.setMargin(0.05);

  let localInertia = new Ammo.btVector3(0, 0, 0);
  colShape.calculateLocalInertia(mass, localInertia);

  let rbInfo = new Ammo.btRigidBodyConstructionInfo(
    mass,
    motionState,
    colShape,
    localInertia
  );
  let body = new Ammo.btRigidBody(rbInfo);

  body.setActivationState(4);

  ball.userData.physicsBody = body;
  physicsWorld.addRigidBody(body);

  rigidBodies.push(ball);
}

function reset(state) {
  resetRigidBodies(state);
  createDrone(state);
  state.sim = INITIAL_SIM_DATA();
}

function setupPhysicsWorld() {
  let collisionConfiguration = new Ammo.btDefaultCollisionConfiguration(),
    dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration),
    overlappingPairCache = new Ammo.btDbvtBroadphase(),
    solver = new Ammo.btSequentialImpulseConstraintSolver();

  let physicsWorld = new Ammo.btDiscreteDynamicsWorld(
    dispatcher,
    overlappingPairCache,
    solver,
    collisionConfiguration
  );
  physicsWorld.setGravity(new Ammo.btVector3(0, -9.8, 0));

  tmpTrans = new Ammo.btTransform();
  return physicsWorld;
}

function updatePhysics(
  { physicsWorld, rigidBodies, sim, droneData },
  deltaTime
) {
  // Step world

  if (droneData)
    for (let step = 0; step < deltaTime; step++) {
      physicsWorld.stepSimulation(1 / 1000.0, 0);

      let batteryDrain =
        (sim.throttle * (100 * (droneData.batteryC * (1 / 1000)))) / 3600;
      sim.battery = Math.max(0, sim.battery - batteryDrain);

      let jouleCons = (batteryDrain / 100) * droneData.j;
      let wattCons = jouleCons / 0.001;
      let lift = droneData.motorLiftPerWatt * wattCons;
      let drone = rigidBodies[0];
      let droneAmmo = drone.userData.physicsBody;
      let liftVec = new Ammo.btVector3(0, lift / 1000, 0);

      droneAmmo.applyImpulse(liftVec, new Ammo.btVector3(0, 0, 0));
      sim.ms += 1;

      if (sim.ms % 30 === 0) {
        sim.batteryChart.push(sim.battery);
        droneAmmo.getMotionState().getWorldTransform(tmpTrans);
        let y = tmpTrans.getOrigin().y();
        sim.yChart.push(y);
        let vy = droneAmmo.getLinearVelocity().y();

        sim.vyChart.push(vy);
      }
    }
  // physicsWorld.stepSimulation(deltaTime / 1000.0, 10000, 1 / 1000);

  // Update rigid bodies
  for (let i = 0; i < rigidBodies.length; i++) {
    let objThree = rigidBodies[i];
    let objAmmo = objThree.userData.physicsBody;
    let ms = objAmmo.getMotionState();
    if (ms) {
      ms.getWorldTransform(tmpTrans);
      let p = tmpTrans.getOrigin();
      let q = tmpTrans.getRotation();
      objThree.position.set(p.x(), p.y(), p.z());
      objThree.quaternion.set(q.x(), q.y(), q.z(), q.w());
    }
  }
}

const INITIAL_DRONE_DATA = () => {
  return {
    type: "quadrotor +",
    motorCenterDistance: 100, //mm
    motorKV: 10000, // RPM/V
    motorMass: 20, //g
    motorLiftPerWatt: 0.05, //N/W
    escMass: 20, //g
    batteryMass: 100, //g
    batteryS: 2,
    batteryP: 1,
    batteryC: 45, // h-1
    batteryCapacity: 850, // mAh
    frameMass: 100, //g
    totalMass: 0,
    v: 0,
    mA: 0,
    w: 0,
    j: 0,
  };
};
const INITIAL_SIM_DATA = () => {
  return {
    battery: 100,
    batteryChart: [],
    yChart: [],
    vyChart: [],
    throttle: 0,
    ms: 0,
  };
};
function computeTotalMass(drone) {
  return {
    totalMass:
      drone.escMass * 4 +
      drone.motorMass * 4 +
      drone.batteryMass +
      drone.frameMass,
  };
}

function computeMaxElec(drone) {
  let v = drone.batteryS * 3.7;
  let mA = drone.batteryC * drone.batteryCapacity; //mA
  let w = (v * mA) / 1000;
  let j = ((drone.batteryCapacity * 3600) / 1000) * v;
  return { v, mA, w, j };
}

export default function EditorFrag() {
  let stateRef = useRef(null);
  let canvasRef = useRef();
  let [droneData, setDroneData_] = useState(INITIAL_DRONE_DATA());
  let [simData, setSimData] = useState(INITIAL_SIM_DATA());
  let [droneComputed, setDroneComputed] = useState(false);
  function setDroneData(arg) {
    setDroneData_(arg);
    setDroneComputed(false);
  }

  useEffect(() => {
    if (droneComputed) {
      if (stateRef.current?.alive) {
        stateRef.current.droneData = droneData;
        reset(stateRef.current);
      }
    } else {
      let newDrone = {
        ...cloneDeep(droneData),
        ...computeMaxElec(droneData),
        ...computeTotalMass(droneData),
      };
      if (stateRef.current?.alive) stateRef.current.droneData = newDrone;
      setDroneData_(newDrone);
      setDroneComputed(true);
    }
  }, [droneData, droneComputed]);
  useEffect(() => {
    async function test() {
      console.log("Trying to load Ammo.js");
      try {
        Ammo = await Ammo();

        stateRef.current = init(canvasRef.current);
        stateRef.current.physicsWorld = setupPhysicsWorld();

        stateRef.current.rigidBodies = [];
        createBlock(stateRef.current);
        stateRef.current.alive = true;
        setDroneComputed(false);
        stateRef.current.sim = INITIAL_SIM_DATA();
      } catch (e) {
        console.error("ammo: ", e);
        setTimeout(() => test(), 500);
      }
    }
    if (Ammo?.btDefaultCollisionConfiguration == undefined) test();
  }, []);

  useAnimationFrame((dt) => {
    if (stateRef.current != null) {
      let {
        camera,
        scene,
        renderer,

        sim,
        droneData,
        rigidBodies,
        physicsWorld,
      } = stateRef.current;

      updatePhysics({ physicsWorld, rigidBodies, sim, droneData }, dt);
      setSimData(cloneDeep(sim));
      renderer.render(scene, camera);
    }
  });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",

        background: "rgb(62, 62, 62)",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div> {simData.ms + "ms"}</div>
          <div> {simData.battery.toFixed(2) + "%"}</div>
          <Chart
            name={"battery"}
            arrf={() => stateRef.current?.sim?.batteryChart}
          ></Chart>
          <Chart name={"y"} arrf={() => stateRef.current?.sim?.yChart}></Chart>
          <Chart
            name={"vy"}
            arrf={() => stateRef.current?.sim?.vyChart}
          ></Chart>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: "10px",
            left: "50%",
            transform: "translate(-50%,0%)",
          }}
        >
          <input
            type="range"
            min="0"
            max="1"
            value="0"
            step="0.01"
            value={simData.throttle}
            onChange={(e) =>
              (stateRef.current.sim.throttle = parseFloat(e.target.value))
            }
          ></input>
        </div>
        <canvas ref={canvasRef} style={{ flex: "1 1 auto" }}></canvas>
      </div>

      <div style={{ width: "300px", overflowY: "auto", height: "100%" }}>
        <NumberIn
          name={"motor center distance"}
          unit={"mm"}
          value={droneData.motorCenterDistance}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, motorCenterDistance: v };
            })
          }
        ></NumberIn>

        <NumberIn
          name={"motor kv"}
          unit={"RPM/V"}
          value={droneData.motorKV}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, motorKV: v };
            })
          }
        ></NumberIn>

        <NumberIn
          name={"single motor mass"}
          unit={"g"}
          value={droneData.motorMass}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, motorMass: v };
            })
          }
        ></NumberIn>
        <NumberIn
          name={"motor lift"}
          unit={"N/W"}
          value={droneData.motorLiftPerWatt}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, motorLiftPerWatt: v };
            })
          }
        ></NumberIn>

        <NumberIn
          name={"single esc mass"}
          unit={"g"}
          value={droneData.escMass}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, escMass: v };
            })
          }
        ></NumberIn>
        <NumberIn
          name={"battery mass"}
          unit={"g"}
          value={droneData.batteryMass}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, batteryMass: v };
            })
          }
        ></NumberIn>
        <NumberIn
          name={"battery capacity"}
          unit={"mAh"}
          value={droneData.batteryCapacity}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, batteryCapacity: v };
            })
          }
        ></NumberIn>
        <NumberIn
          name={"battery S"}
          unit={""}
          value={droneData.batteryS}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, batteryS: v };
            })
          }
        ></NumberIn>

        <NumberIn
          name={"battery P"}
          unit={""}
          value={droneData.batteryP}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, batteryP: v };
            })
          }
        ></NumberIn>
        <NumberIn
          name={"battery C"}
          unit={"h-1"}
          value={droneData.batteryC}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, batteryC: v };
            })
          }
        ></NumberIn>
        <NumberIn
          name={"frame mass"}
          unit={"g"}
          value={droneData.frameMass}
          setValue={(v) =>
            setDroneData((old) => {
              return { ...old, frameMass: v };
            })
          }
        ></NumberIn>
        <TextOut
          name={"total mass"}
          unit={"g"}
          value={droneData.totalMass}
        ></TextOut>
        <TextOut name={"total V"} unit={"V"} value={droneData.v}></TextOut>
        <TextOut
          name={"max current"}
          unit={"mA"}
          value={droneData.mA}
        ></TextOut>
        <TextOut name={"max power"} unit={"W"} value={droneData.w}></TextOut>
      </div>
    </div>
  );
}

function NumberIn({ name, unit, value, setValue }) {
  return (
    <div
      style={{
        color: "white",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        padding: "10px",
      }}
    >
      <div style={{ textAlign: "left" }}>{name}</div>
      <div
        style={{
          color: "white",
          display: "flex",
          flexDirection: "row",
          justifyContent: "flex-start",
          alignItems: "center",
          width: "120px",
          flex: "none",
        }}
      >
        <input
          style={{ width: "60px" }}
          value={value}
          type="number"
          onChange={(e) => {
            let fl = parseFloat(e.target.value);
            setValue(fl);
          }}
        ></input>{" "}
        <span style={{ marginLeft: "5px" }}>{unit}</span>
      </div>
    </div>
  );
}

function TextOut({ name, unit, value }) {
  return (
    <div
      style={{
        color: "white",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        padding: "10px",
      }}
    >
      <div style={{ textAlign: "left" }}>{name}</div>
      <div
        style={{
          color: "white",
          display: "flex",
          flexDirection: "row",
          justifyContent: "flex-start",
          alignItems: "center",
          width: "120px",
          flex: "none",
        }}
      >
        <input disabled style={{ width: "60px" }} value={value}></input>{" "}
        <span style={{ marginLeft: "5px" }}>{unit}</span>
      </div>
    </div>
  );
}

const INIT_CHART = () => {
  return {
    min: 9999,
    max: -9999,
    lastComputeIndex: -1,
  };
};
function Chart({ arrf, name }) {
  let ref = useRef();

  let stateRef = useRef(INIT_CHART());
  let w = 200;
  let h = 200;
  useAnimationFrame((dt) => {
    //
    let arr = arrf();
    if (!ref.current || !arr || !stateRef.current) return;

    if (stateRef.current.lastComputeIndex > arr.length - 1)
      stateRef.current = INIT_CHART();

    let state = stateRef.current;
    ref.current.width = w;
    ref.current.height = h;
    let ctx = ref.current.getContext("2d");
    ctx.width = w;
    ctx.height = h;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, w, h);

    for (let i = state.lastComputeIndex + 1; i < arr.length; i++) {
      state.min = Math.min(state.min, arr[i]);
      state.max = Math.max(state.max, arr[i]);
    }
    state.lastComputeIndex = arr.length - 1;
    let split = state.max - state.min;
    let max = state.max + split / 10;
    let min = state.min - split / 10;

    let toY = (v) => h - (h * (v - min)) / (max - min);
    let toX = (v) => (v * w) / (arr.length - 1);
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(arr[0] || 0));
    arr.forEach((v, i) => {
      ctx.lineTo(toX(i), toY(v));
    });
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  });

  return (
    <div
      style={{
        border: "1px solid black",
        background: "rgba(0,0,0,0.8)",
        color: "white",
      }}
    >
      <div>{name}</div>
      <canvas ref={ref} style={{ width: w + "px", height: h + "px" }}></canvas>
    </div>
  );
}
