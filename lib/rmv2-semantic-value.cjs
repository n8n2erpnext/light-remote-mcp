module.exports=function strictSemanticValue(value){
  if(typeof value!=='string'||value.length>262144||!value.isWellFormed()||value.includes('\0'))throw Error('desktop_semantic_value_invalid_or_over_budget');
  return value;
};
