
function toast(message){
  const t=document.querySelector('.toast');
  if(!t)return;
  t.textContent=message;t.style.display='block';
  setTimeout(()=>t.style.display='none',2600);
}
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-toast]').forEach(el=>{
    el.addEventListener('click',e=>{e.preventDefault();toast(el.dataset.toast)});
  });
  const search=document.querySelector('#serviceSearch');
  if(search){
    search.addEventListener('submit',e=>{
      e.preventDefault();
      const q=document.querySelector('#searchInput').value.trim();
      window.location.href='search.html'+(q?'?q='+encodeURIComponent(q):'');
    });
  }
  document.querySelectorAll('[data-fill]').forEach(b=>{
    b.addEventListener('click',()=>{if(search){document.querySelector('#searchInput').value=b.dataset.fill;document.querySelector('#searchInput').focus()}});
  });
  const params=new URLSearchParams(location.search), q=params.get('q');
  const title=document.querySelector('#resultsTitle');
  if(title&&q) title.textContent='Professionals for “'+q+'”';
});
