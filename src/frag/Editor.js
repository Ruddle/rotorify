import React, { useState } from "react";
import { useEffect, useRef } from "react";
import {
  clamp,
  flatstep,
  smoothstep,
  useAnimationFrame,
  hsv2rgb,
} from "./utils";

let Ammo = window.Ammo;

/**
 * @template T
 * @typedef  {T extends Promise<infer Value> ? Value : T} PromiseValue
 */

/** @type {PromiseValue<import('@dimforge/rapier3d')>} */
var RAPIER;

const THREE = require("three");

// const { GLTFLoader } = require("three/examples/jsm/loaders/GLTFLoader");

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

const TRAINING_TIME_MS = 20000;

const TRAINING_EPSILON = 0.001;

const STAGE_FREE = "Free";
const STAGE_FREE_ASSER_0 = "Free (angular position, altitude)";
const STAGE_TRAINING_ALT = "Training altitude PID";
const STAGE_TRAINING_VROT = "Training angular position PID";

const INITIAL_DRONE_DATA = () => {
  return {
    type: "quadrotor x",
    motorCenterDistance: 1000, //mm
    motorKV: 10000, // RPM/V
    motorMass: 20, //g
    motorLiftPerWatt: 0.02, //N/W
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
    stage: STAGE_FREE,
    pids: {
      alt: {
        p: 1,
        i: 0,
        d: 0,

        accI: [],
      },
    },
    simTime: 0,
    deltaToSim: 0,
    training: {
      maxspeed: true,
      alt: {
        currentErrAcc: 0,
        errs: [],
        p: 0.1,
        i: 1 / 1000,
        d: 1 / 100,
        currentDir: "p",
        target: (t) =>
          2 +
          1.5 *
            flatstep(
              -0.1,
              0.1,
              Math.sin(Math.PI * 2 * 2 * Math.pow(t / 15000, 2))
            ),
      },
    },
    camera: {
      position: [-4, 1.7, 0],
      lookAt: [0, 1.7, 0],
      followPos: false,
      followLook: true,
    },
  };
};

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
  camera.position.set(-4, 1.7, 0);
  camera.lookAt(new THREE.Vector3(0, 1.7, 0));

  // let loader = new GLTFLoader();
  // loader.load(
  //   process.env.PUBLIC_URL + "/static/coords.gltf",
  //   (gltf) => {
  //     scene.add(gltf.scene);
  //   },
  //   () => {},
  //   (error) => {
  //     console.error(error);
  //   }
  // );

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

  let d = 10;

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

  let target = createTarget({ scene });

  return { camera, scene, renderer, target };
}

function createTarget({ scene }) {
  let pos = { x: 0, y: 3, z: 0 };
  let scale = { x: 0.1, y: 0.1, z: 0.1 };
  //threeJS Section
  let target = new THREE.Mesh(
    new THREE.BoxBufferGeometry(),
    new THREE.MeshPhongMaterial({ color: 0xff00ff })
  );
  target.position.set(pos.x, pos.y, pos.z);
  target.scale.set(scale.x, scale.y, scale.z);
  target.castShadow = true;
  target.receiveShadow = true;
  scene.add(target);
  return (x, y, z) => target.position.set(x, y, z);
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
  let pos = { x: 0, y: 3, z: 0 };

  let quat = { x: 0, y: 0, z: 0, w: 1 };
  let mass = droneData.totalMass / 1000;

  let motorUpdateGraphicSpeedArray = [];
  let group = new THREE.Group();
  let radius = 2 / 100;
  let mcd_meters = droneData.motorCenterDistance / 1000;
  if (droneData.type === "quadrotor x") {
    let createMotor = (x, y, z) => {
      let motor = new THREE.Mesh(
        new THREE.SphereBufferGeometry(radius),
        new THREE.MeshPhongMaterial({ color: 0xff0505 })
      );
      motor.position.set(x, y, z);
      motor.castShadow = true;
      group.add(motor);
      motorUpdateGraphicSpeedArray.push((speed) => {
        motor.material.setValues({
          color: new THREE.Color(
            "hsl(" +
              speed * 360 +
              ", 100%, " +
              Math.floor(20 + 80 * speed) +
              "%)"
          ),
        });
      });
      return motor;
    };

    let angles = [
      ((1 + 0) * Math.PI) / 4,
      ((1 + 2) * Math.PI) / 4,
      ((1 + 4) * Math.PI) / 4,
      ((1 + 6) * Math.PI) / 4,
    ];
    angles.forEach((angle) => {
      let x = mcd_meters * Math.sin(angle);
      let y = mcd_meters * Math.cos(angle);
      let m = createMotor(x, 0, y);
    });

    let createRod = (sx, sy, sz) => {
      let rod = new THREE.Mesh(
        new THREE.BoxBufferGeometry(sx, sy, sz),
        new THREE.MeshPhongMaterial({ color: 0x000000 })
      );
      rod.position.set(0, 0, 0);
      rod.castShadow = true;
      group.add(rod);
      return rod;
    };

    let rod1 = createRod(mcd_meters * 2, radius / 2, radius / 2);
    rod1.rotation.set(0, Math.PI / 4, 0);
    let rod2 = createRod(mcd_meters * 2, radius / 2, radius / 2);
    rod2.rotation.set(0, -Math.PI / 4, 0);

    let rodX = new THREE.Mesh(
      new THREE.BoxBufferGeometry(mcd_meters, radius / 2, radius / 2),
      new THREE.MeshPhongMaterial({ color: 0xff0000 })
    );
    rodX.position.set(mcd_meters / 2, radius, 0);
    rodX.castShadow = true;
    group.add(rodX);

    let rodZ = new THREE.Mesh(
      new THREE.BoxBufferGeometry(mcd_meters, radius / 2, radius / 2),
      new THREE.MeshPhongMaterial({ color: 0x00ff00 })
    );
    rodZ.position.set(0, radius, mcd_meters / 2);
    rodZ.rotation.set(0, Math.PI / 2, 0);
    rodZ.castShadow = true;
    group.add(rodZ);

    let rodY = new THREE.Mesh(
      new THREE.BoxBufferGeometry(mcd_meters, radius / 2, radius / 2),
      new THREE.MeshPhongMaterial({ color: 0x0000ff })
    );
    rodY.position.set(0, mcd_meters / 2, 0);
    rodY.rotation.set(0, 0, Math.PI / 2);
    rodY.castShadow = true;
    group.add(rodY);
  }

  group.position.set(pos.x, pos.y, pos.z);
  // group.rotation.set(0, Math.PI, 0);

  group.castShadow = true;
  group.receiveShadow = true;

  scene.add(group);

  //Ammojs Section
  let transform = new Ammo.btTransform();
  transform.setIdentity();
  let tempVec = new Ammo.btVector3(pos.x, pos.y, pos.z);
  transform.setOrigin(tempVec);
  Ammo.destroy(tempVec);

  let tempQuat = new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w);
  transform.setRotation(tempQuat);
  Ammo.destroy(tempQuat);
  let motionState = new Ammo.btDefaultMotionState(transform);
  Ammo.destroy(transform);

  let colShape = new Ammo.btBoxShape(
    new Ammo.btVector3(
      droneData.motorCenterDistance / 1000,
      2 / 100,
      droneData.motorCenterDistance / 1000
    )
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

  body.setActivationState(4);

  group.userData.physicsBody = body;
  group.userData.motorUpdateGraphicSpeedArray = motorUpdateGraphicSpeedArray;
  physicsWorld.addRigidBody(body);

  rigidBodies.push(group);
}

function reset(state, keepSimTraining = true) {
  resetRigidBodies(state);
  createDrone(state);
  if (keepSimTraining) {
    let { pids, training, stage } = state.sim;
    state.sim = INITIAL_SIM_DATA();
    state.sim.pids = pids;
    state.sim.training = training;
    state.sim.stage = stage;
  } else {
    state.sim = INITIAL_SIM_DATA();
  }
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
function transformer(trans) {
  let basis = trans.getBasis();
  let basisMat = [
    basis.getRow(0).x(),
    basis.getRow(0).y(),
    basis.getRow(0).z(),
    basis.getRow(1).x(),
    basis.getRow(1).y(),
    basis.getRow(1).z(),
    basis.getRow(2).x(),
    basis.getRow(2).y(),
    basis.getRow(2).z(),
  ];

  let basisMatTranspo = [
    basisMat[0],
    basisMat[3],
    basisMat[6],
    basisMat[1],
    basisMat[4],
    basisMat[7],
    basisMat[2],
    basisMat[5],
    basisMat[8],
  ];

  return (x, y, z) => {
    return [
      basisMatTranspo[0 * 3 + 0] * x +
        basisMatTranspo[1 * 3 + 0] * y +
        basisMatTranspo[2 * 3 + 0] * z,
      basisMatTranspo[0 * 3 + 1] * x +
        basisMatTranspo[1 * 3 + 1] * y +
        basisMatTranspo[2 * 3 + 1] * z,
      basisMatTranspo[0 * 3 + 2] * x +
        basisMatTranspo[1 * 3 + 2] * y +
        basisMatTranspo[2 * 3 + 2] * z,
    ];
  };
}
function updatePhysics(state, deltaTime) {
  // Step world

  let startTime = performance.now();
  state.sim.deltaToSim = deltaTime;
  state.sim.simTime = 0;
  if (state.droneData) {
    let simulateOneStep = (state) => {
      let { sim, rigidBodies, physicsWorld, droneData } = state;

      physicsWorld.stepSimulation(0.001, 0);

      let drone = rigidBodies[0];
      let droneAmmo = drone.userData.physicsBody;
      let motorUpdateGraphicSpeedArray =
        drone.userData.motorUpdateGraphicSpeedArray;
      droneAmmo.getMotionState().getWorldTransform(tmpTrans);
      let [x, y, z] = [
        tmpTrans.getOrigin().x(),
        tmpTrans.getOrigin().y(),
        tmpTrans.getOrigin().z(),
      ];

      let transformerInst = transformer(tmpTrans);

      let [vx, vy, vz] = [
        droneAmmo.getLinearVelocity().x(),
        droneAmmo.getLinearVelocity().y(),
        droneAmmo.getLinearVelocity().z(),
      ];

      let fullQuadThrust = () => {
        let batteryDrain =
          (sim.throttle * (100 * (droneData.batteryC * (1 / 1000)))) / 3600;

        let oldBattery = sim.battery;
        sim.battery = Math.max(0, sim.battery - batteryDrain);
        batteryDrain = oldBattery - sim.battery;
        let jouleCons = (batteryDrain / 100) * droneData.j;
        let wattCons = jouleCons / 0.001;
        let lift = droneData.motorLiftPerWatt * wattCons;

        let liftVec = new Ammo.btVector3(0, lift / 1000, 0);
        let relPos = new Ammo.btVector3(0, 0, 0);
        droneAmmo.applyImpulse(liftVec, relPos);
        Ammo.destroy(liftVec);
        Ammo.destroy(relPos);
      };

      let freeThrust = () => {
        let contrib = [0, 0, 0, 0];

        let keys = {};
        ["z", "s", "q", "d", "e", "a"].forEach(
          (k) => (keys[k] = state.keys[k] === true ? 1 : 0)
        );
        let { z, s, q, d, a, e } = keys;

        let axes = state.keys.axes || [0, 0, 0, 0];

        z += -axes[1] * 0.5 + 0.5;
        s += axes[1] * 0.5 + 0.5;
        q += -axes[0] * 0.5 + 0.5;
        d += axes[0] * 0.5 + 0.5;
        a += -axes[2] * 0.5 + 0.5;
        e += axes[2] * 0.5 + 0.5;

        let t = -axes[3] * 0.5 + 0.5;

        contrib[0] += -z + s + q - d + e - a;
        contrib[1] += -z + s - q + d - e + a;
        contrib[2] += z - s - q + d + e - a;
        contrib[3] += z - s + q - d - e + a;

        let min = contrib.reduce((acc, x) => Math.min(acc, x));
        let max = contrib.reduce((acc, x) => Math.max(acc, x));

        let amax = Math.max(Math.abs(min), max);
        if (amax < 1) amax = 1;

        contrib = contrib.map((x) => x / amax);

        if (sim.ms % 500 === 0) {
          console.log("Contrib", contrib);
        }

        contrib.forEach((motor, index) => {
          let commandPower = clamp(sim.throttle + t + motor, 0, 1);
          let batteryDrain =
            (0.25 *
              (commandPower * (100 * (droneData.batteryC * (1 / 1000))))) /
            3600;

          motorUpdateGraphicSpeedArray[index](commandPower);

          let oldBattery = sim.battery;
          sim.battery = Math.max(0, sim.battery - batteryDrain);
          batteryDrain = oldBattery - sim.battery;
          let jouleCons = (batteryDrain / 100) * droneData.j;
          let wattCons = jouleCons / 0.001;
          let lift = droneData.motorLiftPerWatt * wattCons;

          let rpx,
            rpy,
            rpz = 0;

          let angle = ((1 + 2 * index) * Math.PI) / 4;
          let mcd_meters = droneData.motorCenterDistance / 1000;
          rpx = mcd_meters * Math.sin(angle);
          rpz = mcd_meters * Math.cos(angle);

          let torque = (0.1 * lift) / 1000;
          let orthoX = -Math.cos(angle) * torque * (index % 2 == 0 ? 1 : -1);
          let orthoZ = Math.sin(angle) * torque * (index % 2 == 0 ? 1 : -1);

          let liftVecWorld = new Ammo.btVector3(
            ...transformerInst(orthoX, lift / 1000, orthoZ)
          );

          let liftPosWorld = new Ammo.btVector3(
            ...transformerInst(rpx, 0, rpz)
          );

          droneAmmo.applyImpulse(liftVecWorld, liftPosWorld);

          Ammo.destroy(liftPosWorld);
          Ammo.destroy(liftVecWorld);
        });
      };

      if (sim.stage === STAGE_TRAINING_ALT) {
        {
          //RESET ORIENTATION
          droneAmmo.getMotionState().getWorldTransform(tmpTrans);
          let quat = { x: 0, y: 0, z: 0, w: 1 };
          let q = new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w);
          tmpTrans.setRotation(q);
          Ammo.destroy(q);
          droneAmmo.getMotionState().setWorldTransform(tmpTrans);
        }

        let ty = state.sim.training.alt.target(sim.ms);
        state.target(0, ty, 0);

        let altErr = ty - y;
        if (sim.ms >= 0)
          state.sim.training.alt.currentErrAcc += Math.pow(
            Math.abs(altErr / 100),
            1
          );

        sim.pids.alt.accI = sim.pids.alt.accI + altErr / 100;
        sim.pids.alt.accI *= 0.995;

        sim.pids.alt.pContrib = sim.pids.alt.p * altErr;
        sim.pids.alt.dContrib = -sim.pids.alt.p * sim.pids.alt.d * vy;
        sim.pids.alt.iContrib =
          sim.pids.alt.p * sim.pids.alt.i * sim.pids.alt.accI;

        sim.throttle = clamp(
          sim.pids.alt.pContrib + sim.pids.alt.dContrib + sim.pids.alt.iContrib,
          0,
          1
        );

        fullQuadThrust();
      }

      if (sim.stage === STAGE_FREE) {
        freeThrust();
      }

      if (sim.ms % 30 === 0) {
        sim.batteryChart.push(sim.battery);
        sim.yChart.push(y);
        sim.vyChart.push(vy);
      }

      sim.ms += 1;

      let trainingSeshOver =
        [STAGE_TRAINING_VROT, STAGE_TRAINING_ALT].includes(sim.stage) &&
        sim.ms >= TRAINING_TIME_MS;
      if (trainingSeshOver) {
        let oldSim = state.sim;

        reset(state);
        state.sim.training = oldSim.training;
        state.sim.pids = oldSim.pids;

        //Adjust pid

        console.log(
          state.sim.training.alt.errs.length +
            " : " +
            state.sim.training.alt.currentErrAcc +
            " / ",
          state.sim.pids.alt.p +
            "/" +
            state.sim.pids.alt.i +
            "/" +
            state.sim.pids.alt.d
        );
        if (state.sim.training.alt.errs.length > 0) {
          let before =
            state.sim.training.alt[state.sim.training.alt.currentDir];
          if (
            state.sim.training.alt.currentErrAcc <
            state.sim.training.alt.errs[state.sim.training.alt.errs.length - 1]
          ) {
            // console.log("WAS GOOD");

            state.sim.training.alt[state.sim.training.alt.currentDir] *= 1.2;
          } else {
            // console.log("WAS BAD");
            state.sim.training.alt[state.sim.training.alt.currentDir] *= -0.5;
          }
        }

        state.sim.training.alt.errs.push(state.sim.training.alt.currentErrAcc);
        state.sim.training.alt.currentErrAcc = 0;
        state.sim.training.alt.currentDir =
          state.sim.training.alt.currentDir === "p"
            ? "d"
            : state.sim.training.alt.currentDir === "d"
            ? "i"
            : "p";

        state.sim.pids.alt[state.sim.training.alt.currentDir] +=
          state.sim.training.alt[state.sim.training.alt.currentDir];

        state.sim.pids.alt[state.sim.training.alt.currentDir] = Math.max(
          0,
          state.sim.pids.alt[state.sim.training.alt.currentDir]
        );

        state.sim.training.alt.accI = 0;

        if (state.sim.training.alt.errs.length > 5) {
          let a = state.sim.training.alt.errs;
          let l = a.length;
          if (
            Math.abs(a[l - 5] - a[l - 4]) / a[l - 4] < TRAINING_EPSILON &&
            Math.abs(a[l - 4] - a[l - 3]) / a[l - 3] < TRAINING_EPSILON &&
            Math.abs(a[l - 3] - a[l - 2]) / a[l - 2] < TRAINING_EPSILON &&
            Math.abs(a[l - 2] - a[l - 1]) / a[l - 1] < TRAINING_EPSILON
          ) {
            state.sim.stage = STAGE_FREE;
            state.sim.training.maxspeed = false;
          }
        }
      }
    };

    let notMaxSpeed =
      ![STAGE_TRAINING_VROT, STAGE_TRAINING_ALT].includes(state.sim.stage) ||
      !state.sim.training.maxspeed;
    if (notMaxSpeed) {
      for (let step = 0; step < deltaTime; step++) {
        simulateOneStep(state);
      }
    } else {
      let stepDone = 0;
      let msPerStep = 1;
      while (
        performance.now() - startTime + msPerStep <
        Math.min(deltaTime, 1000 / 60)
      ) {
        simulateOneStep(state);
        stepDone += 1;
        msPerStep = (performance.now() - startTime) / stepDone;
      }
    }
  }
  state.sim.simTime = performance.now() - startTime;
  // Update rigid bodies
  for (let i = 0; i < state.rigidBodies.length; i++) {
    let objThree = state.rigidBodies[i];
    let objAmmo = objThree.userData.physicsBody;
    let ms = objAmmo.getMotionState();
    if (ms) {
      ms.getWorldTransform(tmpTrans);
      let p = tmpTrans.getOrigin();
      let q = tmpTrans.getRotation();
      objThree.position.set(p.x(), p.y(), p.z());

      let transformerInst = transformer(tmpTrans);

      if (state.sim.camera.followPos) {
        let [rx, ry, rz] = transformerInst(-2, 0.5, 0);
        let [fx, fy, fz] = transformerInst(1, 0, 0);
        state.camera.position.set(p.x() + rx, p.y() + ry, p.z() + rz);
        state.camera.lookAt(p.x() + fx, p.y() + fy, p.z() + fz);
      } else if (state.sim.camera.followLook) {
        state.camera.lookAt(p.x(), p.y(), p.z());
      }

      objThree.quaternion.set(q.x(), q.y(), q.z(), q.w());
    }
  }
}

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
    setTimeout(() => {
      window.addEventListener("keydown", function (event) {
        if (stateRef.current) {
          stateRef.current.keys[event.key] = true;
        }
      });
      window.addEventListener("keyup", function (event) {
        if (stateRef.current) {
          stateRef.current.keys[event.key] = false;
        }
      });
    }, 50);
  }, []);

  useEffect(() => {
    setInterval(() => {
      console.log(stateRef.current);
    }, 5000);
  }, []);

  useEffect(() => {
    if (droneComputed) {
      if (stateRef.current?.alive) {
        stateRef.current.droneData = droneData;
        reset(stateRef.current, false);
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
        RAPIER = await import("@dimforge/rapier3d");

        stateRef.current = init(canvasRef.current);
        stateRef.current.physicsWorld = setupPhysicsWorld();

        stateRef.current.rigidBodies = [];
        createBlock(stateRef.current);
        stateRef.current.alive = true;
        setDroneComputed(false);
        stateRef.current.sim = INITIAL_SIM_DATA();
        stateRef.current.keys = {};
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
        keys,
        sim,
        droneData,
        rigidBodies,
        physicsWorld,
      } = stateRef.current;

      let gpds = navigator.getGamepads();
      for (let i = 0; i < gpds.length; i++) {
        let gp = gpds[i];
        if (gp && gp.id.includes("Sony")) {
          keys.axes = [
            gp.axes[0],
            gp.axes[1],
            gp.buttons[6].value * 2 - 1,
            gp.buttons[7].value * 2 - 1,
          ];
        }
      }

      if (rigidBodies.length > 0) updatePhysics(stateRef.current, dt);
      let c1 = cloneDeep(sim);
      setSimData(c1);
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
          <div> {simData.ms.toFixed(2) + "ms"}</div>
          <div> {simData.simTime.toFixed(2) + "ms"}</div>
          <div> {simData.deltaToSim.toFixed(2) + "ms"}</div>

          <Chart
            name={"battery"}
            arrf={() => stateRef.current?.sim?.batteryChart}
          ></Chart>
          <Chart name={"y"} arrf={() => stateRef.current?.sim?.yChart}></Chart>

          <Chart
            name={"errs"}
            arrf={() => stateRef.current?.sim?.training.alt.errs}
          ></Chart>
          <div>
            {(() => {
              let pid = simData.pids.alt;
              let dpid = simData.training.alt;
              return (
                <div>
                  <div>
                    p: {pid.p} + {dpid.p}
                  </div>
                  <div>
                    i: {pid.i} + {dpid.i}
                  </div>
                  <div>
                    d: {pid.d} + {dpid.d}
                  </div>
                </div>
              );
            })()}
          </div>

          <div>
            <span>p</span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={simData.pids.alt.pContrib}
            ></input>
          </div>
          <div>
            <span>i</span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={simData.pids.alt.iContrib}
            ></input>
          </div>
          <div>
            <span>d</span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={simData.pids.alt.dContrib}
            ></input>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: "10px",
            left: "50%",
            transform: "translate(-50%,0%)",
          }}
        >
          <div
            style={{
              background: "rgba(0,0,0,0.2)",
              borderRadius: "5px",
              padding: "5px",
              color: "white",
              cursor: "pointer",
            }}
            onClick={() =>
              (stateRef.current.sim.training.maxspeed =
                !stateRef.current.sim.training.maxspeed)
            }
          >
            MAX SPEED : {simData.training.maxspeed ? "True" : "False"}
          </div>

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

        {/* General sim  */}
        <div
          style={{
            position: "absolute",
            bottom: "10px",
            right: "10px",
            // transform: "translate(-50%,0%)",
            background: "rgba(0,0,0,0.2)",
            padding: "20px",
          }}
        >
          {[
            STAGE_FREE,
            STAGE_FREE_ASSER_0,
            STAGE_TRAINING_ALT,
            STAGE_TRAINING_VROT,
          ].map((stage) => {
            let active = simData.stage === stage;
            return (
              <div
                onClick={() => {
                  reset(stateRef.current, true);
                  stateRef.current.sim.stage = stage;
                }}
                style={{
                  cursor: active ? "auto" : "pointer",
                  border: active ? "1px solid green" : "none",
                }}
              >
                {stage}
              </div>
            );
          })}
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
  let [current, setCurrent] = useState(0);
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
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, 0, w, h);

    if (arr.length > 0) setCurrent(arr[arr.length - 1]);

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
        background: "rgba(0,0,0,0.6)",
        color: "white",
        width: w + "px",
      }}
    >
      <div>
        {name}: {current.toFixed(2)}
      </div>
      <canvas ref={ref} style={{ width: w + "px", height: h + "px" }}></canvas>
    </div>
  );
}
