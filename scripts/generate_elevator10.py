#!/usr/bin/env python3
"""Generate circuits/elevator-10floor.json — a 10-story relay elevator.

Design (per floor n):
  register   GCOM -> G(n) -> [S(n) // K(n).13-14] -> K(n).A1   (calls only register
             for floors the car is NOT at — deck B is the complement deck)
  run/stop   F(n) -> K(n).21-22 -> R  (R dies when the car reaches a called floor)
  dispatch   R -> KM_run coil, and via Up/Down selectors to KM_up / KM_down coils
  any-call   K(n).A1 -> K(n).L1-T1 -> P   (mains pole reused as a NO contact)
  cam feed   P -> CAM.COM  (car position routes 'any call pending' to the current floor)
  travel seal   K(n).A1 is sealed by S(n)//13-14 fed from the G(n) net, so calls persist
             while traveling and auto-reset when the car arrives (G(n) opens) and
             KM_run drops.
"""
import json

comps = [
    {"id": "X1", "type": "supply3", "label": "X1", "x": 40, "y": 40},
    {"id": "Q1", "type": "breaker3", "label": "Q1", "x": 180, "y": 160, "state": {"closed": True}},
    {"id": "F1", "type": "fuse3", "label": "F1", "x": 320, "y": 320},
    {"id": "KM_run", "type": "contactor", "label": "KM_run", "x": 460, "y": 460},
    {"id": "KM_up", "type": "contactor", "label": "KM_up", "x": 900, "y": 460},
    {"id": "KM_dn", "type": "contactor", "label": "KM_dn", "x": 900, "y": 760},
    {"id": "KK1", "type": "overload", "label": "KK1", "x": 1140, "y": 590, "params": {"flc": 15, "trip_class": 10}},
    {"id": "M1", "type": "motor3", "label": "M1 Hoist", "x": 1400, "y": 760, "params": {"flc": 15, "load": 0.9}},
    {"id": "F4", "type": "fuse1", "label": "F4", "x": 1320, "y": 320},
    {"id": "CAM1", "type": "cam10", "label": "CAM1 Car pos", "x": 1660, "y": 470, "state": {"position": 1}},
    {"id": "SelUp", "type": "selector2", "label": "SelUp", "x": 1380, "y": 920, "state": {"pos": "1"}},
    {"id": "SelDn", "type": "selector2", "label": "SelDn", "x": 1380, "y": 1060},
    {"id": "KP", "type": "contactor", "label": "KP Dispatch", "x": 1300, "y": 1240},
    {"id": "KT_dwell", "type": "timer_on", "label": "KT_dwell", "x": 1300, "y": 1480, "params": {"delay": 1.5}},
    {"id": "R1", "type": "junction", "label": "R (run)", "x": 1330, "y": 1310},
    {"id": "N1", "type": "junction", "label": "N", "x": 80, "y": 1240},
]
wires = []

# POWER PATH (fixed): X1 -> Q1 -> F1 -> KM_run -> {KM_up | KM_dn} -> KK1 -> M1
# The direction contactors are IN the power path now. KM_dn swaps L2/L3 so the
# hoist motor actually reverses; both feed the common overload KK1, then M1.
wires += [
    {"from": "X1.L1", "to": "Q1.L1"}, {"from": "X1.L2", "to": "Q1.L2"}, {"from": "X1.L3", "to": "Q1.L3"},
    {"from": "Q1.T1", "to": "F1.L1"}, {"from": "Q1.T2", "to": "F1.L2"}, {"from": "Q1.T3", "to": "F1.L3"},
    {"from": "F1.T1", "to": "KM_run.L1"}, {"from": "F1.T2", "to": "KM_run.L2"}, {"from": "F1.T3", "to": "KM_run.L3"},
    # KM_run outputs feed both direction contactors (line side)
    {"from": "KM_run.T1", "to": "KM_up.L1", "waypoints": [[590, 590], [590, 488], [890, 488]]},
    {"from": "KM_run.T2", "to": "KM_up.L2", "waypoints": [[600, 590], [600, 496], [920, 496]]},
    {"from": "KM_run.T3", "to": "KM_up.L3", "waypoints": [[610, 590], [610, 504], [950, 504]]},
    {"from": "KM_run.T1", "to": "KM_dn.L1", "waypoints": [[575, 590], [575, 640], [890, 640], [890, 788]]},
    {"from": "KM_run.T2", "to": "KM_dn.L2", "waypoints": [[585, 590], [585, 650], [920, 650], [920, 788]]},
    {"from": "KM_run.T3", "to": "KM_dn.L3", "waypoints": [[595, 590], [595, 660], [950, 660], [950, 788]]},
    # KM_up -> KK1 (straight through)
    {"from": "KM_up.T1", "to": "KK1.L1", "waypoints": [[1000, 645], [1160, 645]]},
    {"from": "KM_up.T2", "to": "KK1.L2", "waypoints": [[1050, 655], [1190, 655]]},
    {"from": "KM_up.T3", "to": "KK1.L3", "waypoints": [[1060, 665], [1220, 665]]},
    # KM_dn -> KK1 (L2/L3 SWAPPED: reversal); risers merge into the matching phase bus
    {"from": "KM_dn.T1", "to": "KK1.L1", "waypoints": [[1000, 860], [1000, 645]]},
    {"from": "KM_dn.T2", "to": "KK1.L3", "waypoints": [[1080, 860], [1080, 665]]},
    {"from": "KM_dn.T3", "to": "KK1.L2", "waypoints": [[1100, 860], [1100, 655]]},
    # KK1 -> motor
    {"from": "KK1.T1", "to": "M1.U", "waypoints": [[1160, 740], [1420, 740]]},
    {"from": "KK1.T2", "to": "M1.V", "waypoints": [[1190, 725], [1450, 725]]},
    {"from": "KK1.T3", "to": "M1.W", "waypoints": [[1220, 710], [1480, 710]]},
]
# ELECTRICAL CROSS-INTERLOCK: each direction coil is fed through the other
# contactor's NC aux (21-22), so both can never energize together.
wires += [
    {"from": "SelUp.14", "to": "KM_dn.21", "waypoints": [[1410, 858], [1050, 858]]},
    {"from": "KM_dn.22", "to": "KM_up.A1", "waypoints": [[990, 810], [990, 570]]},
    {"from": "SelDn.14", "to": "KM_up.21", "waypoints": [[1410, 700], [1040, 700], [1040, 545]]},
    {"from": "KM_up.22", "to": "KM_dn.A1", "waypoints": [[975, 510], [975, 870]]},
]
# control feed
wires.append({"from": "F1.T1", "to": "KK1.95", "waypoints": [[340, 438], [1230, 438], [1230, 560]]})
wires.append({"from": "KK1.96", "to": "F4.L", "waypoints": [[1360, 610], [1360, 350]]})
wires += [
    {"from": "KP.A2", "to": "N1.T", "waypoints": [[1360, 1310], [1360, 1420], [120, 1420], [120, 1250]]},
    {"from": "R1.T", "to": "KP.13"},
    {"from": "KP.14", "to": "KT_dwell.A1", "waypoints": [[1410, 1310], [1405, 1310], [1405, 1500]]},
    {"from": "KT_dwell.A2", "to": "N1.T", "waypoints": [[1330, 1530], [1330, 1560], [120, 1560], [120, 1250]]},
    {"from": "KT_dwell.16", "to": "KM_run.A1", "waypoints": [[1330, 1610], [1470, 1610], [1470, 1370], [595, 1370], [595, 597]]},
    {"from": "KT_dwell.16", "to": "SelUp.13", "waypoints": [[1330, 1610], [1400, 1610], [1400, 1090], [1405, 1090], [1405, 950]]},
    {"from": "KT_dwell.16", "to": "SelDn.13", "waypoints": [[1330, 1610], [1420, 1610], [1420, 1090]]},
    {"from": "R1.T", "to": "KT_dwell.15", "waypoints": [[1340, 1310], [1290, 1310], [1290, 1560]]},
    {"from": "F4.T", "to": "KP.43", "waypoints": [[1350, 390], [1470, 390], [1470, 1300]]},
    {"from": "KP.44", "to": "CAM1.COM", "waypoints": [[1460, 1400], [1930, 1400], [1930, 455], [1690, 455]]},
    {"from": "KM_run.A2", "to": "N1.T", "waypoints": [[595, 670], [595, 710], [120, 710], [120, 1250]]},
    {"from": "KM_up.A2", "to": "N1.T", "waypoints": [[1035, 650], [1035, 700], [120, 700], [120, 1250]]},
    {"from": "KM_dn.A2", "to": "N1.T", "waypoints": [[1035, 950], [1035, 1000], [120, 1000], [120, 1250]]},
    {"from": "X1.N", "to": "N1.T", "waypoints": [[90, 100], [90, 1250]]},
]
# F(n) -> K(n).21  (stop chain feeds)
for n in range(1, 11):
    wires.append({"from": f"CAM1.F{n}", "to": f"K{n}.21"})
# per-floor components + control
for n in range(1, 11):
    row = n - 1
    y0 = 1100 + row * 230          # floor row top (below the power section)
    comps += [
        {"id": f"S{n}", "type": "pushbutton_no", "label": f"S{n} Floor {n}", "x": 760, "y": y0},
        {"id": f"K{n}", "type": "contactor", "label": f"K{n}", "x": 420, "y": y0},
        {"id": f"H{n}", "type": "lamp", "label": f"H{n}", "x": 980, "y": y0, "params": {"color": "#ffb454"}},
    ]
    wires += [
        {"from": "F4.T", "to": f"CAM1.GH{n}", "waypoints": [[1620, 415]]},
        {"from": f"CAM1.G{n}", "to": f"S{n}.13"},
        {"from": f"S{n}.14", "to": f"K{n}.14"},
        {"from": f"CAM1.G{n}", "to": f"K{n}.13"},
        {"from": f"K{n}.14", "to": f"K{n}.A1"},
        {"from": f"K{n}.14", "to": f"K{n}.43"},
        {"from": f"K{n}.44", "to": f"CAM1.H{n}"},
        {"from": f"CAM1.HH{n}", "to": "KP.A1"},
        {"from": f"K{n}.A2", "to": "N1.T"},
        {"from": f"K{n}.22", "to": "R1.T"},
        {"from": f"K{n}.A1", "to": f"H{n}.1"},
        {"from": f"H{n}.2", "to": "N1.T"},
    ]

demo = [
    {"caption": "VoltLab — 10-story relay elevator (car at floor 1)"},
    {"wait": 2.5},
    {"caption": "Passenger at floor 5 registers a call"},
    {"press": "S5"}, {"wait": 1.2}, {"release": "S5"},
    {"caption": "KM_run + KM_up energize — hoist motor starts upward"},
    {"wait": 2.5},
    {"caption": "Car travels: floor 2... 3... 4..."},
    {"cam": ["CAM1", 2]}, {"wait": 1.0},
    {"cam": ["CAM1", 3]}, {"wait": 1.0},
    {"cam": ["CAM1", 4]}, {"wait": 1.0},
    {"caption": "Arriving at floor 5 — the cam opens K5's run contact"},
    {"cam": ["CAM1", 5]}, {"wait": 2.5},
    {"caption": "Served: KM_run drops, call 5 auto-resets"},
    {"wait": 2.0},
    {"caption": "New call: floor 9 (car re-dispatches automatically)"},
    {"press": "S9"}, {"wait": 1.0}, {"release": "S9"},
    {"cam": ["CAM1", 6]}, {"wait": 0.8},
    {"cam": ["CAM1", 7]}, {"wait": 0.8},
    {"cam": ["CAM1", 8]}, {"wait": 0.8},
    {"cam": ["CAM1", 9]}, {"wait": 2.5},
    {"caption": "Floor 9 served — no calls pending, car holds"},
    {"wait": 2.0},
    {"caption": "Operator selects DOWN and calls floor 2"},
    {"toggle": "SelUp"}, {"toggle": "SelDn"},
    {"press": "S2"}, {"wait": 1.0}, {"release": "S2"},
    {"cam": ["CAM1", 8]}, {"wait": 0.7},
    {"cam": ["CAM1", 7]}, {"wait": 0.7},
    {"cam": ["CAM1", 6]}, {"wait": 0.7},
    {"cam": ["CAM1", 5]}, {"wait": 0.7},
    {"cam": ["CAM1", 4]}, {"wait": 0.7},
    {"cam": ["CAM1", 3]}, {"wait": 0.7},
    {"cam": ["CAM1", 2]}, {"wait": 2.5},
    {"caption": "Floor 2 served — end of demo"},
    {"wait": 2.5},
]

json.dump({"name": "elevator-10floor", "description": "Full 10-story relay elevator. Car position is a two-deck floor cam (CAM1): deck A routes 'call pending' power to the current floor, deck B (complement) enables call registration for every floor the car is NOT at. Floor calls latch in relays K1..K10 (lamps H1..H10); the run contactor KM_run dies when the cam reaches a called floor (F(n) through K(n).21-22), which also resets that call via its deck-B seal — so pending calls auto-dispatch. The power path runs X1-Q1-F1-KM_run-{KM_up|KM_dn}-KK1-M1: KM_up passes the phases straight through while KM_dn swaps L2/L3, so the hoist motor genuinely reverses for down calls; NC aux cross-interlocks (KM_up 21-22 in the KM_dn coil path and vice versa) make it impossible to energize both. Try: press a floor button, then advance CAM1 floor by floor.", "components": comps, "wires": [w for w in wires if w], "demo": demo}, open("circuits/elevator-10floor.json", "w"), indent=1)
print(f"elevator-10floor.json: {len(comps)} components, {len([w for w in wires if w])} wires")
