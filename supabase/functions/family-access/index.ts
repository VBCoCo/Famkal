import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {makeHandler} from './handler.mjs';
Deno.serve(makeHandler(createClient,(name:string)=>Deno.env.get(name)));
