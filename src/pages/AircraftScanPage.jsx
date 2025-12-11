
import { useState, useRef } from "react";

export default function AircraftScanPage({ flightId }){
  const [zone,setZone]=useState(1);
  const [count,setCount]=useState(0);
  const inputRef=useRef(null);

  const handle=(e)=>{
    e.preventDefault();
    const tag=inputRef.current.value.trim();
    if(!tag) return;
    setCount(c=>c+1);
    inputRef.current.value="";
  };

  return(
    <div>
      <h2>Aircraft Scan - {flightId}</h2>
      <select value={zone} onChange={e=>setZone(Number(e.target.value))}>
        <option value={1}>Zone 1</option>
        <option value={2}>Zone 2</option>
        <option value={3}>Zone 3</option>
        <option value={4}>Zone 4</option>
      </select>
      <p>Total scanned: {count}</p>
      <form onSubmit={handle}>
        <input ref={inputRef} placeholder="Scan tag"/>
      </form>
    </div>
  );
}
