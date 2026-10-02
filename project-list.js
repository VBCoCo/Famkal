import { escapeHtml as esc } from './calendar-utils.js';

export const projectStatus = {collected:'Gesammelt',planned:'Geplant',in_progress:'In Arbeit',implemented:'Umgesetzt',verified:'Geprüft',discarded:'Verworfen'};
const categories={bug:'Fehler',feature:'Wunsch',security:'Sicherheit',test:'Prüfung'};
const priorities={high:'Hoch',normal:'Normal',low:'Niedrig'};
const completed=item=>['implemented','verified','discarded'].includes(item.status);
const date=value=>new Date(value).toLocaleString('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'});
async function read(sb,table,family,configure=q=>q) {
  const rows=[];
  for(let offset=0;;offset+=500) {
    const result=await configure(sb.from(table).select('*').eq('family_id',family)).range(offset,offset+499);
    if(result.error) throw result.error;
    rows.push(...result.data);
    if(result.data.length<500) return rows;
  }
}
export async function mountProjectList(root,sb,family,isCurrent=()=>true) {
  root.innerHTML='<p role="status">Projektliste wird geladen …</p>';
  try {
    const [items,releases]=await Promise.all([
      read(sb,'project_items',family,q=>q.order('item_no')),
      read(sb,'project_releases',family,q=>q.order('created_at',{ascending:false}).order('id'))
    ]);
    if(!isCurrent()) return;
    let filter='open';
    const render=()=>{
      if(!isCurrent()) return;
      const visible=items.filter(item=>filter==='all'||(filter==='open'?!completed(item):completed(item)));
      root.innerHTML='<p>Wünsche, Fehler und Änderungen für Famkal. Die Pflege erfolgt hier über unseren Chat.</p>'+
        '<div class="project-filters" role="group" aria-label="Punkte filtern">'+[['open','Offen'],['done','Abgeschlossen'],['all','Alle']].map(([key,label])=>'<button type="button" data-project-filter="'+key+'" aria-pressed="'+(filter===key)+'">'+label+'</button>').join('')+'</div>'+
        '<p class="small">'+items.filter(item=>!completed(item)).length+' offen · '+items.filter(completed).length+' abgeschlossen</p>'+
        (visible.length?visible.map(item=>'<details class="project-item"><summary><b>#'+Number(item.item_no)+' '+esc(item.title)+'</b><small>'+esc(projectStatus[item.status]||item.status)+' · '+esc(categories[item.category]||item.category)+'</small></summary>'+
          '<p class="project-text">'+esc(item.description)+'</p><p class="small">Priorität: '+esc(priorities[item.priority])+'<br>Geplant: '+esc(item.planned_version||'noch offen')+' · Erledigt in: '+esc(item.completed_version||'—')+'<br>Erstellt: '+esc(date(item.created_at))+' · Geändert: '+esc(date(item.updated_at))+'</p>'+
          '<button type="button" data-project-history="'+esc(item.id)+'">Änderungshistorie anzeigen</button><div class="project-history" aria-live="polite"></div></details>').join(''):'<p>Keine Punkte in dieser Auswahl.</p>')+
        '<h3>Versionen</h3>'+releases.map(release=>'<details class="project-item"><summary><b>'+esc(release.version)+'</b><small>'+esc(release.status==='released'?'Veröffentlicht':'Geplant')+(release.released_at?' · '+esc(date(release.released_at)):'')+'</small></summary><p class="project-text">'+esc(release.notes)+'</p>'+
          '<p class="small">Punkte: '+esc(items.filter(item=>item.completed_version===release.version||item.planned_version===release.version).map(item=>'#'+item.item_no).join(', ')||'keine Zuordnung')+'</p><button type="button" data-project-history="'+esc(release.id)+'" data-release-history="true">Änderungshistorie anzeigen</button><div class="project-history" aria-live="polite"></div></details>').join('');
      root.querySelectorAll('[data-project-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.projectFilter;render();});
      root.querySelectorAll('[data-project-history]').forEach(button=>button.onclick=async()=>{
        const target=button.nextElementSibling;
        button.disabled=true; target.textContent='Historie wird geladen …';
        try {
          const history=await read(sb,'project_item_history',family,q=>q.eq(button.dataset.releaseHistory?'release_id':'item_id',button.dataset.projectHistory).order('changed_at',{ascending:false}).order('id',{ascending:false}));
          if(!isCurrent()||!root.contains(target)) return;
          target.innerHTML=history.length?history.map(entry=>{
            const fields={title:'Titel',description:'Beschreibung',status:'Status',priority:'Priorität',category:'Kategorie',planned_version:'Geplante Version',completed_version:'Erledigt in',version:'Version',notes:'Versionsinhalt',released_at:'Veröffentlicht',commit_sha:'Commit'};
            const changes=Object.entries(fields).filter(([key])=>JSON.stringify(entry.old_values?.[key])!==JSON.stringify(entry.new_values?.[key])).map(([key,label])=>{
              const display=value=>key==='status'?projectStatus[value]||value:value;
              return '<li>'+label+': '+esc(display(entry.old_values?.[key])??'—')+' → '+esc(display(entry.new_values?.[key])??'—')+'</li>';
            }).join('');
            return '<article><b>'+esc(date(entry.changed_at))+' · '+esc(entry.source==='chat'?'Chat':'Datenbank')+'</b><p>'+esc(entry.change_note|| (entry.operation==='INSERT'?'Punkt aufgenommen':'Punkt geändert'))+'</p>'+(changes?'<ul>'+changes+'</ul>':'')+'</article>';
          }).join(''):'Noch keine Änderungen.';
          button.textContent='Historie geladen';
        } catch { if(isCurrent()&&root.contains(target)){target.textContent='Historie konnte nicht geladen werden. Bitte erneut versuchen.';button.disabled=false;} }
      });
    };
    render();
  } catch {
    if(!isCurrent()) return;
    root.innerHTML='<p role="alert">Projektliste konnte nicht geladen werden. Bitte Internetverbindung prüfen und erneut versuchen.</p><button type="button">Erneut laden</button>';
    root.querySelector('button').onclick=()=>mountProjectList(root,sb,family,isCurrent);
  }
}
