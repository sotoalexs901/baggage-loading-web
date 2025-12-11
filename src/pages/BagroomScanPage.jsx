
import { useState, useRef } from "react";

export default function BagroomScanPage({ flightId }){
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
      <h2>Bagroom Scan - {flightId}</h2>
      <p>Scanned: {count}</p>
      <form onSubmit={handle}>
        <input ref={inputRef} placeholder="Scan tag"/>
      </form>
    </div>
  );
}
