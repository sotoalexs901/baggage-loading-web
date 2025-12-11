
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import LoginPage from './pages/LoginPage.jsx';
import FlightsPage from './pages/FlightsPage.jsx';
import CounterPage from './pages/CounterPage.jsx';
import BagroomScanPage from './pages/BagroomScanPage.jsx';
import AircraftScanPage from './pages/AircraftScanPage.jsx';

export default function App(){
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("flights");
  const [flightId, setFlightId] = useState(null);

  useEffect(()=> {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
    return ()=>unsub();
  },[]);

  if(loading) return <p>Loading...</p>;
  if(!user) return <LoginPage/>;

  return (
    <div style={{padding:20}}>
      <h1>BLCS System</h1>
      <p>Logged in as {user.email} <button onClick={()=>signOut(auth)}>Logout</button></p>

      <div style={{display:'flex',gap:10}}>
        <button onClick={()=>setView("flights")}>Flights</button>
        <button disabled={!flightId} onClick={()=>setView("counter")}>Counter</button>
        <button disabled={!flightId} onClick={()=>setView("bagroom")}>Bagroom</button>
        <button disabled={!flightId} onClick={()=>setView("aircraft")}>Aircraft</button>
      </div>

      {view === "flights" && <FlightsPage onFlightSelected={(id)=>{setFlightId(id); setView("counter");}}/>}
      {view === "counter" && <CounterPage flightId={flightId}/>}
      {view === "bagroom" && <BagroomScanPage flightId={flightId}/>}
      {view === "aircraft" && <AircraftScanPage flightId={flightId}/>}
    </div>
  );
}
